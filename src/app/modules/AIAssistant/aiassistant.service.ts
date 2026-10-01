import axios from "axios";
import FormData from "form-data";
import httpStatus from "http-status";
import prisma from "../../../shared/prisma";
import ApiError from "../../../errors/ApiErrors";
import {
  buildGenerationInstructions,
  foldInstructionsIntoPayload,
  DocumentTaxonomy,
  OrganizationContextStructured,
} from "./navigatorGenerate.prompt";
import {
  getNavigatorGroundingExcerpt,
  resolveNavigatorISOStandard,
  looksLikeImsRequirement,
  INSTRUCTIONS_GROUNDING_CAP,
} from "./navigatorGenerate.grounding";
import {
  applyLatestLibraryEditionsToPayload,
  rewriteStandardLabelToLatest,
} from "./isoStandardVersion";
import { ensureNavigatorImsSuggestions } from "./navigatorIms";
import {
  hasRequiredNavigatorStructure,
  isValidNavigatorContent,
  normalizeNavigatorResponse,
} from "./navigatorGenerate.normalize";
import {
  AUDIT_STEP_META,
  buildAuditStepInstructions,
  foldAuditInstructionsIntoPayload,
} from "./auditLens.prompt";
import {
  isValidAuditGuidance,
  hasAuditCaseStudyContent,
  ensureHypotheticalCaseStudyLabel,
  normalizeAuditContextResponse,
  normalizeAuditStepResponse,
  ensureIntegratedManagementSystemsOptions,
} from "./auditLens.normalize";
import { getAuditGuidelineExcerpt } from "./auditLens.grounding";
import {
  enrichCourseLearningContext,
  excerptLockedIsoFromBuffer,
  LEARNING_BRIEF_HEADER,
} from "./courseLearning.grounding";
import {
  LIBRARY_BRIEF_HEADER,
  LIBRARY_FLASHCARD_INSTRUCTION,
  buildLibraryAvailableSources,
  buildLibraryTaskInstructions,
  excerptIsoOverviewFromBuffer,
  getLibraryRelatedDocumentExcerpt,
  normalizeLibraryFlashcardDeck,
  resolveLibraryTask,
  sanitizeLibraryAssistantText,
} from "./libraryStandards.grounding";

const NAVIGATOR_GENERATE_TIMEOUT_MS = 120000;
// Remote /discovery/iso-suggestions often exceeds 60s (LLM + ranking).
const ISO_SUGGESTIONS_TIMEOUT_MS = 180000;
const CONTEXT_GENERATOR_TIMEOUT_MS = 180000;

function orgContextToString(
  ctx: string | OrganizationContextStructured | undefined,
): string {
  if (!ctx) return "";
  if (typeof ctx === "string") return ctx.trim();
  const parts = [ctx.what, ctx.where, ctx.why, ctx.when, ctx.whom]
    .filter(Boolean)
    .map((s) => String(s).trim())
    .map((s) => (/[.?!]$/.test(s) ? s : `${s}.`));
  return parts.join(" ");
}

function resolveStructuredContext(payload: any): OrganizationContextStructured | undefined {
  if (payload.organization_context_structured && typeof payload.organization_context_structured === "object") {
    return payload.organization_context_structured;
  }
  if (payload.organization_context && typeof payload.organization_context === "object") {
    return payload.organization_context as OrganizationContextStructured;
  }
  return undefined;
}

async function callNavigatorGenerate(aiPayload: Record<string, unknown>) {
  try {
    const response = await axios.post(
      `${process.env.AI_BASE_URL}/navigator/generate`,
      aiPayload,
      { timeout: NAVIGATOR_GENERATE_TIMEOUT_MS },
    );
    return response.data;
  } catch (error: any) {
    throw mapAiProxyError(error, "ISO Navigator generation");
  }
}

const generateISO = async (payload: any = {}) => {
  const structured = resolveStructuredContext(payload);
  const organization_context = orgContextToString(
    typeof payload.organization_context === "string"
      ? payload.organization_context
      : structured || payload.organization_context,
  );

  const specific_requirements_raw = String(payload.specific_requirements || "").trim();
  const isIms = looksLikeImsRequirement(specific_requirements_raw);

  // IMS labels must stay multi-standard — never collapse to a single ISO title.
  // Single standards: lock to the selected library edition (exact year when specified).
  let specific_requirements = specific_requirements_raw;
  if (isIms) {
    const libraryTitles = await prisma.iSOStandard.findMany({
      where: { status: "ACTIVE" },
      select: { title: true },
      take: 200,
    });
    specific_requirements = rewriteStandardLabelToLatest(
      specific_requirements_raw,
      libraryTitles,
    );
    console.log(
      `[Navigator] IMS context preserved "${specific_requirements_raw}" → "${specific_requirements}"`,
    );
  } else {
    const resolved = await resolveNavigatorISOStandard(specific_requirements_raw);
    if (!resolved.ok) {
      if (resolved.reason === "edition_unavailable") {
        const avail =
          resolved.availableYears.length > 0
            ? resolved.availableYears.join(", ")
            : "none";
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Selected edition ${resolved.family}:${resolved.requestedYear} is not available in the Standards Library (available: ${avail}). No silent fallback was applied.`,
        );
      }
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Selected ISO standard is not available in the Standards Library.",
      );
    }
    specific_requirements = resolved.selected.title;
    if (resolved.selected.title !== specific_requirements_raw) {
      console.log(
        `[Navigator] remapped selected standard "${specific_requirements_raw}" → "${resolved.selected.title}" (${resolved.selected.id}) exact=${resolved.exactYearMatched}`,
      );
    }
  }
  const output_type = String(payload.output_type || payload.document_title || "").trim();
  const document_title = String(
    payload.document_title || payload.output_type || "Documented Information",
  ).trim();
  const clause = payload.clause ? String(payload.clause).trim() : undefined;
  const document_taxonomy = payload.document_taxonomy as DocumentTaxonomy | undefined;
  const tone = String(payload.tone || "professional").trim();
  const language = String(payload.language || "English").trim();

  if (!organization_context || organization_context.length < 10) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Organization context is required for ISO Navigator generation.",
    );
  }
  if (!specific_requirements) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "ISO standard (specific_requirements) is required.",
    );
  }
  if (!output_type) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Document type (output_type) is required.",
    );
  }

  const grounding = await getNavigatorGroundingExcerpt({
    specificRequirements: specific_requirements,
    clause,
    documentTitle: document_title,
  });

  if (isIms && grounding.missingEditions && grounding.missingEditions.length > 0) {
    // IMS may list several standards — do not block the whole generate when one
    // edition is absent. Continue with available standards; never silently swap years.
    if (!grounding.standardId && !(grounding.excerpt || "").trim()) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `None of the selected ISO editions are available in the Standards Library: ${grounding.missingEditions.join("; ")}. No silent fallback was applied.`,
      );
    }
    console.log(
      `[Navigator] IMS proceeding without unavailable editions: ${grounding.missingEditions.join("; ")}`,
    );
  }

  const generation_instructions = buildGenerationInstructions({
    orgContext: organization_context,
    structured,
    isoStandard: specific_requirements,
    clause,
    documentTitle: document_title,
    outputType: output_type,
    taxonomy: document_taxonomy,
    tone,
    language,
    groundingExcerpt: grounding.excerpt || undefined,
    instructionsGroundingCap: INSTRUCTIONS_GROUNDING_CAP,
    isIms: grounding.isIms || isIms,
    imsGuideTitle: grounding.imsGuideTitle,
    imsGuideAvailable: grounding.imsGuideAvailable,
    missingEditions: grounding.missingEditions,
  });

  const folded = foldInstructionsIntoPayload({
    organization_context,
    specific_requirements,
    output_type,
    clause,
    documentTitle: document_title,
    taxonomy: document_taxonomy,
  });

  // Server-owned prompt only — never trust client override keys
  const aiPayload: Record<string, unknown> = {
    organization_context: folded.organization_context,
    specific_requirements: folded.specific_requirements,
    output_type: folded.output_type,
    tone,
    language,
    clause,
    document_title,
    document_taxonomy,
    generation_instructions,
    grounding_excerpt: grounding.excerpt || undefined,
    grounded_standard: grounding.standardTitle || undefined,
  };

  // Remove undefined keys to keep payload compact
  Object.keys(aiPayload).forEach((key) => {
    if (aiPayload[key] === undefined || aiPayload[key] === "") {
      delete aiPayload[key];
    }
  });

  const meta = {
    organization_context,
    tone,
    language,
    clause,
    document_taxonomy,
    iso_standard: specific_requirements,
    grounded_standard: grounding.standardTitle,
    ims_guide_title: grounding.imsGuideTitle,
    ims_guide_available: isIms ? grounding.imsGuideAvailable === true : undefined,
    missing_editions:
      grounding.missingEditions && grounding.missingEditions.length > 0
        ? grounding.missingEditions
        : undefined,
    fallbackTitle: document_title,
  };

  let raw = await callNavigatorGenerate(aiPayload);
  let normalized = normalizeNavigatorResponse(raw, meta);

  // Single retry when empty OR missing the required 3-section package
  const needsRetry =
    !isValidNavigatorContent(normalized.content) ||
    !hasRequiredNavigatorStructure(normalized);

  if (needsRetry) {
    raw = await callNavigatorGenerate({
      ...aiPayload,
      retry: true,
      generation_instructions: `${generation_instructions}\n\nIMPORTANT: Previous response was empty or missing required sections. Return non-empty markdown with exact H2s: (1) Documented Information Template (2) Implementation Guidance Package (3) Daily Usability & Operational Tools. Do not claim compliance.`,
    });
    normalized = normalizeNavigatorResponse(raw, meta);
  }

  if (!isValidNavigatorContent(normalized.content)) {
    throw new ApiError(
      httpStatus.BAD_GATEWAY,
      "ISO Navigator returned an empty or invalid document. Please try again.",
    );
  }

  return normalized;
};

const simpleChat = async (payload: any = {}) => {
  const formData = new FormData();

  // 🔥 messages
  formData.append(
    "messages",
    typeof payload.messages === "string"
      ? payload.messages
      : payload.messages?.[0]?.content || "",
  );

  // 🔥 optional context
  formData.append(
    "context",
    typeof payload.context === "string"
      ? payload.context
      : JSON.stringify(payload.context || {}),
  );

  // 🔥 optional session_id (AI supports but we ignore DB)
  if (payload.session_id) {
    formData.append("session_id", payload.session_id);
  }

  // ❌ NO file handling (as requested)

  const response = await axios.post(
    `${process.env.AI_BASE_URL}/chat`,
    formData,
    {
      headers: formData.getHeaders(),
    },
  );

  return response.data;
};

// Generate short title
const generateTitle = (text: string) => {
  if (!text) return "New Chat";

  return text
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(" ")
    .slice(0, 5)
    .join(" ");
};

// Validate ObjectId
const isValidObjectId = (id: string) => {
  return /^[a-fA-F0-9]{24}$/.test(id);
};



const chat = async (userId: string, payload: any = {}) => {
  const { messages, session_id } = payload;

  let session = null;

  // 🔥 1. parse context FIRST (important)
  let finalContext: any = {};

  if (typeof payload.context === "string") {
    try {
      finalContext = JSON.parse(payload.context);
    } catch {
      finalContext = {};
    }
  } else {
    finalContext = payload.context || {};
  }

  // 🔥 1b. Course / Learning AI enrichment (reuse shared chat + ISO attach)
  const questionText =
    typeof messages === "string"
      ? messages
      : messages?.[0]?.content || payload.question || "";

  try {
    const enriched = await enrichCourseLearningContext({
      userId,
      context: finalContext,
      question: questionText,
    });
    finalContext = enriched.context;
  } catch (error) {
    // Preserve ApiError (auth/enrollment); soft-fail unexpected enrichment errors.
    if (error instanceof ApiError) throw error;
    console.error("Course learning context enrichment failed:", error);
  }

  const isoStandardId = finalContext?.isoStandardId;

  // 🔥 2. ONLY logged user → session logic
  if (userId) {
    // find existing session
    if (session_id && isValidObjectId(session_id)) {
      session = await prisma.chatSession.findUnique({
        where: { id: session_id },
      });
      // Tenant/user isolation: never reuse another user's session
      if (session && session.userId !== userId) {
        throw new ApiError(httpStatus.FORBIDDEN, "Forbidden chat session");
      }
    }

    // create new session
    if (!session && !session_id) {
      session = await prisma.chatSession.create({
        data: {
          user: {
            connect: { id: userId }, // ✅ FIXED
          },
          title:
            typeof messages === "string"
              ? generateTitle(messages)
              : typeof questionText === "string" && questionText
                ? generateTitle(questionText)
                : "New Chat",
          isoStandardId: isoStandardId || null,
        },
      });
    }

    // invalid session
    if (!session) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid or expired session");
    }
  }

  // 🔥 3. inject ISO data (exact selected standard — no edition substitution)
  let downloadedFile = null;
  let isoFileAttachFailed = false;

  if (isoStandardId && isValidObjectId(isoStandardId)) {
    const iso = await prisma.iSOStandard.findUnique({
      where: { id: isoStandardId },
    });

    if (iso) {
      finalContext.isoStandard = {
        title: iso.title,
      };

      // Library Ask AI: mark purpose when not already course_learning
      if (finalContext.purpose !== "course_learning") {
        finalContext.purpose = "library_standards";
        finalContext.available_sources = buildLibraryAvailableSources(iso.title);
      }

      // Preserve Course Learning instruction when already set by enrichment.
      if (!finalContext.instruction) {
        finalContext.instruction =
          "Answer based on the provided ISO document content. Be specific and avoid generic answers. Do not invent clauses or editions.";
      }

      // Download file from DB if not provided by client
      if (!payload.file && iso.fileUrl) {
        try {
          const fileRes = await axios.get(iso.fileUrl, {
            responseType: "arraybuffer",
            timeout: 60000,
          });
          const fileName = iso.fileUrl.split("/").pop() || "document.pdf";

          downloadedFile = {
            buffer: fileRes.data,
            originalname: fileName,
          };
          finalContext.iso_file_attached = true;
        } catch (error: any) {
          isoFileAttachFailed = true;
          finalContext.iso_file_attached = false;
          console.error(
            `[AIChat] ISO PDF download failed id=${isoStandardId} status=${error?.response?.status || "n/a"} message=${error?.message || error}`,
          );
        }
      } else if (payload.file) {
        finalContext.iso_file_attached = true;
      }
    } else {
      console.error(`[AIChat] ISO standard not found id=${isoStandardId}`);
    }
  }

  console.log(
    `[AIChat] purpose=${finalContext?.purpose || "general"} iso=${isoStandardId || "n/a"} fileAttached=${Boolean(downloadedFile || payload.file)} session=${session?.id || "n/a"}`,
  );

  // Course / Library: focused ISO clause/keyword excerpt from the same buffer (no second download).
  const tLibraryGround = Date.now();
  const isoBufferForExcerpt =
    downloadedFile?.buffer || payload.file?.buffer || null;
  const libraryTaskPreview =
    finalContext?.purpose === "library_standards"
      ? resolveLibraryTask(finalContext, questionText || "")
      : "chat";
  const wantsStudyOverview =
    finalContext?.purpose === "library_standards" &&
    libraryTaskPreview !== "chat";
  // Library: always try a focused excerpt when PDF is available (not only when clause # mentioned).
  const wantsClauseExcerpt =
    (finalContext?.purpose === "course_learning" &&
      isoBufferForExcerpt &&
      !finalContext.iso_clause_excerpt &&
      /\b(?:clause|cl\.?|section)\s*\d|\b\d+\.\d+/.test(questionText || "")) ||
    (finalContext?.purpose === "library_standards" &&
      isoBufferForExcerpt &&
      !finalContext.iso_clause_excerpt);

  const isoExcerptPromise = wantsClauseExcerpt
    ? (async () => {
        try {
          let excerpt = await excerptLockedIsoFromBuffer(
            isoBufferForExcerpt,
            questionText,
          );
          if (
            !excerpt &&
            (wantsStudyOverview || finalContext?.purpose === "library_standards")
          ) {
            excerpt = await excerptIsoOverviewFromBuffer(isoBufferForExcerpt);
            if (excerpt && !wantsStudyOverview) {
              excerpt = excerpt.slice(0, 1600);
            }
          }
          return excerpt || "";
        } catch (error) {
          console.error("ISO clause excerpt failed:", error);
          return "";
        }
      })()
    : Promise.resolve("");

  const relatedDocPromise =
    finalContext?.purpose === "library_standards" &&
    finalContext.isoStandard?.title &&
    !finalContext.library_doc_excerpt
      ? getLibraryRelatedDocumentExcerpt({
          isoTitle: String(finalContext.isoStandard.title),
          question: questionText,
        }).catch((error) => {
          console.error("Library related document excerpt failed:", error);
          return { excerpt: "", title: undefined as string | undefined };
        })
      : Promise.resolve({ excerpt: "", title: undefined as string | undefined });

  // Run ISO excerpt + Documents Library retrieval in parallel on Library path.
  const [isoExcerpt, relatedDoc] = await Promise.all([
    isoExcerptPromise,
    relatedDocPromise,
  ]);

  if (isoExcerpt) {
    finalContext.iso_clause_excerpt = isoExcerpt;
  }
  if (relatedDoc.excerpt) {
    finalContext.library_doc_excerpt = relatedDoc.excerpt;
    if (relatedDoc.title) {
      const sources = Array.isArray(finalContext.available_sources)
        ? finalContext.available_sources
        : [];
      if (!sources.includes(relatedDoc.title)) {
        finalContext.available_sources = [...sources, relatedDoc.title].slice(
          0,
          6,
        );
      }
    }
  }

  if (finalContext?.purpose === "library_standards") {
    console.log(
      `[Library][timing] grounding=${Date.now() - tLibraryGround}ms task=${libraryTaskPreview} isoExcerpt=${Boolean(finalContext.iso_clause_excerpt)} docExcerpt=${Boolean(finalContext.library_doc_excerpt)}`,
    );
  }

  // Normalize message field for callAI (academy historically sent `question`)
  if (!payload.messages && questionText) {
    payload.messages = questionText;
  }

  // Course Learning: lean remote contract (remote /chat 400s on large/unknown context).
  let remoteContext = finalContext;
  if (finalContext?.purpose === "course_learning") {
    const userQ =
      typeof payload.messages === "string"
        ? payload.messages
        : payload.messages?.[0]?.content || questionText || "";

    const lockedIso =
      finalContext.isoStandard?.title ||
      (typeof finalContext.isoStandardId === "string"
        ? `id:${finalContext.isoStandardId}`
        : "");

    const sourcesList = Array.isArray(finalContext.available_sources)
      ? finalContext.available_sources.join("; ")
      : "";

    const brief = [
      LEARNING_BRIEF_HEADER,
      lockedIso ? `LOCKED ISO EDITION: ${lockedIso}` : "",
      sourcesList
        ? `AVAILABLE SOURCES (cite only these if needed): ${sourcesList}`
        : "",
      finalContext.course?.title
        ? `COURSE: ${finalContext.course.title}`
        : "",
      finalContext.lesson?.title
        ? `LESSON: ${finalContext.lesson.title}`
        : "",
      finalContext.course_grounding
        ? `MATERIAL:\n${String(finalContext.course_grounding).slice(0, 2400)}`
        : finalContext.course_grounding_note
          ? String(finalContext.course_grounding_note)
          : "",
      finalContext.iso_clause_excerpt
        ? `RELEVANT ISO EXCERPT (locked edition only):\n${String(finalContext.iso_clause_excerpt).slice(0, 1800)}`
        : "",
      `QUESTION: ${userQ}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    payload.messages = brief;

    remoteContext = {
      isoStandardId: finalContext.isoStandardId || undefined,
      purpose: "course_learning",
      instruction:
        "Answer as a course learning assistant. Use only the learning context and attached locked ISO document. Prefer Answer / Why it matters / Example / Related requirement / From your course. Never invent clauses, editions, or org facts.",
    };
  } else if (finalContext?.purpose === "library_standards") {
    // Library / Standards Ask AI — lean grounded contract on the same engine
    const userQ =
      typeof payload.messages === "string"
        ? payload.messages
        : payload.messages?.[0]?.content || questionText || "";

    const standardTitle =
      finalContext.isoStandard?.title ||
      (typeof finalContext.isoStandardId === "string"
        ? "the selected ISO standard"
        : "the selected ISO standard");

    const libraryTask = resolveLibraryTask(finalContext, userQ);
    const taskInstructions = buildLibraryTaskInstructions(
      libraryTask,
      standardTitle,
    );

    const sourcesList = Array.isArray(finalContext.available_sources)
      ? finalContext.available_sources.join("; ")
      : "";

    const brief = [
      LIBRARY_BRIEF_HEADER,
      `SELECTED STANDARD: ${standardTitle}`,
      sourcesList ? `Sources to prefer: ${sourcesList}` : "",
      taskInstructions,
      finalContext.iso_clause_excerpt
        ? `Source material from the selected standard:\n${String(finalContext.iso_clause_excerpt).slice(0, 1800)}`
        : "",
      finalContext.library_doc_excerpt
        ? `Related reference material:\n${String(finalContext.library_doc_excerpt).slice(0, 1200)}`
        : "",
      isoFileAttachFailed || finalContext.iso_file_attached === false
        ? "NOTE: The selected ISO PDF could not be attached for this request. Do not invent clause text; say the available source material is insufficient if you cannot ground the answer."
        : "",
      `USER REQUEST: ${userQ}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    payload.messages = brief;

    remoteContext = {
      isoStandardId: finalContext.isoStandardId || undefined,
      purpose: "library_standards",
      instruction:
        "Answer as an ISO consultant using the selected ISO standard and any attached ISO document. Do not invent clauses or substitute editions. If evidence is missing, say the available source material is insufficient. Never use internal system terminology.",
    };
  }

  // 🔥 4. prepare AI payload — always forward DB session to remote /chat for follow-ups
  const finalPayload = {
    ...payload,
    context: remoteContext,
    session_id: session?.id || payload.session_id || undefined,
  };

  if (downloadedFile) {
    finalPayload.file = downloadedFile;
  } else if (
    (finalContext?.purpose === "course_learning" ||
      finalContext?.purpose === "library_standards") &&
    finalContext.isoStandardId &&
    !payload.file &&
    isoFileAttachFailed
  ) {
    if (typeof finalPayload.messages === "string") {
      finalPayload.messages +=
        "\n\nNOTE: The selected ISO PDF could not be attached for this request. Do not invent clause text; say the available source material is insufficient if you cannot ground the answer.";
    }
  }

  // 🔥 5. call AI
  let aiResponse = await callAI(finalPayload);

  // Empty / missing AI response — controlled fallback (no fabrication)
  if (
    !aiResponse ||
    typeof aiResponse.response !== "string" ||
    !String(aiResponse.response).trim()
  ) {
    const fallback =
      finalContext?.purpose === "course_learning" ||
      finalContext?.purpose === "library_standards"
        ? "The available source material does not provide enough information to answer this reliably."
        : "I could not generate an answer at this time.";
    aiResponse = {
      ...(aiResponse || {}),
      response: fallback,
      sources: aiResponse?.sources || [],
    };
  }

  if (
    typeof aiResponse?.response === "string" &&
    (finalContext?.purpose === "library_standards" ||
      finalContext?.purpose === "course_learning")
  ) {
    aiResponse.response = sanitizeLibraryAssistantText(aiResponse.response);
  }

  // Prefer / merge platform sources for grounded assistants
  if (
    (finalContext?.purpose === "course_learning" ||
      finalContext?.purpose === "library_standards") &&
    Array.isArray(finalContext.available_sources) &&
    finalContext.available_sources.length
  ) {
    const remoteSources = Array.isArray(aiResponse.sources)
      ? aiResponse.sources.filter((s: unknown) => typeof s === "string")
      : [];
    const merged = [
      ...finalContext.available_sources,
      ...remoteSources.filter(
        (s: string) => !finalContext.available_sources.includes(s),
      ),
    ];
    aiResponse.sources = merged.slice(0, 8);
  }

  // 🔥 6. ONLY logged user → save messages
  if (userId && session) {
    const userMessageForStore =
      typeof messages === "string"
        ? messages
        : typeof questionText === "string" && questionText
          ? questionText
          : JSON.stringify(messages ?? "");

    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        message: userMessageForStore,
      },
    });

    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        message: aiResponse.response,
        sources: aiResponse.sources || [],
        followUps: aiResponse.suggested_followups || [],
      },
    });

    await prisma.chatSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });
  }

  return {
    ...aiResponse,
    session_id: session?.id || null, // 🔥 guest হলে null
  };
};


const generateFlashcards = async (userId: string | undefined, payload: any) => {
  const { session_id, context, file } = payload || {};

  let finalContext: any = {};

  if (typeof context === "string") {
    try {
      finalContext = JSON.parse(context);
    } catch {
      finalContext = {};
    }
  } else {
    finalContext = context || {};
  }

  const isoStandardId = finalContext?.isoStandardId;
  let iso: { id: string; title: string; fileUrl: string | null } | null = null;

  if (isoStandardId && isValidObjectId(isoStandardId)) {
    iso = await prisma.iSOStandard.findUnique({
      where: { id: isoStandardId },
      select: { id: true, title: true, fileUrl: true },
    });
  }

  if (!iso && isoStandardId) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Selected ISO standard was not found for flashcard generation.",
    );
  }

  finalContext.purpose = "library_standards";
  if (iso?.title) {
    finalContext.isoStandard = { title: iso.title };
    finalContext.available_sources = buildLibraryAvailableSources(iso.title);
  }
  finalContext.instruction = LIBRARY_FLASHCARD_INSTRUCTION;

  let session = null;

  if (userId) {
    if (session_id && isValidObjectId(session_id)) {
      session = await prisma.chatSession.findUnique({
        where: { id: session_id },
      });
      if (session && session.userId !== userId) {
        throw new ApiError(httpStatus.FORBIDDEN, "Forbidden chat session");
      }
    }

    if (!session && !session_id) {
      session = await prisma.chatSession.create({
        data: {
          user: {
            connect: { id: userId },
          },
          title: `Flashcards: ${iso?.title || "Study Deck"}`,
          isoStandardId: isoStandardId || null,
        },
      });
    }

    if (!session) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid or expired session");
    }
  }

  const difficulty = String(payload.difficulty || "advanced");
  const numCards = String(payload.num_cards || 12);

  // Related Documents Library excerpt (parallel with PDF attach prep)
  const relatedPromise = iso?.title
    ? getLibraryRelatedDocumentExcerpt({
        isoTitle: iso.title,
        question: "flashcards requirements evidence documented information",
      }).catch(() => ({ excerpt: "", title: undefined as string | undefined }))
    : Promise.resolve({ excerpt: "", title: undefined as string | undefined });

  const formData = new FormData();
  const relatedDoc = await relatedPromise;
  if (relatedDoc.excerpt && relatedDoc.title) {
    finalContext.library_doc_excerpt = relatedDoc.excerpt;
    finalContext.available_sources = [
      ...(Array.isArray(finalContext.available_sources)
        ? finalContext.available_sources
        : []),
      relatedDoc.title,
    ].slice(0, 6);
  }

  formData.append(
    "context",
    JSON.stringify({
      ...finalContext,
      purpose: "library_standards",
      isoStandardId: isoStandardId || undefined,
      instruction: LIBRARY_FLASHCARD_INSTRUCTION,
    }),
  );
  formData.append("num_cards", numCards);
  formData.append("difficulty", difficulty);
  formData.append(
    "messages",
    [
      LIBRARY_FLASHCARD_INSTRUCTION,
      iso?.title ? `SELECTED STANDARD: ${iso.title}` : "",
      buildLibraryTaskInstructions("flashcards", iso?.title || "the selected ISO standard"),
      relatedDoc.excerpt
        ? `Related reference material:\n${relatedDoc.excerpt.slice(0, 1000)}`
        : "",
      `Generate ${numCards} ${difficulty} flashcards grounded in the attached standard PDF.`,
      "Front = exam-style question; Back = concise answer; put clause/requirement in back.title only when supported by sources.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );

  let attachedFile = false;
  if (file) {
    formData.append("file", file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
    attachedFile = true;
  } else if (iso?.fileUrl) {
    try {
      const fileRes = await axios.get(iso.fileUrl, {
        responseType: "arraybuffer",
        timeout: 60000,
        maxContentLength: 8 * 1024 * 1024,
      });
      formData.append("file", Buffer.from(fileRes.data), {
        filename: `${iso.title || "standard"}.pdf`,
      });
      attachedFile = true;
    } catch (error: any) {
      console.error(
        `[Flashcards] ISO PDF download failed id=${isoStandardId} message=${error?.message || error}`,
      );
    }
  }

  if (!attachedFile) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Flashcards require the selected ISO standard PDF. The file could not be loaded.",
    );
  }

  let responseData: any;
  try {
    const response = await axios.post(
      `${process.env.AI_BASE_URL}/quiz/flashcards`,
      formData,
      {
        headers: formData.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 120000,
      },
    );
    responseData = response.data;
  } catch (error: any) {
    throw mapAiProxyError(error, "Flashcard generation");
  }

  const deck = normalizeLibraryFlashcardDeck(
    responseData,
    iso?.title || "ISO Standard",
    difficulty,
  );

  if (!deck) {
    throw new ApiError(
      httpStatus.BAD_GATEWAY,
      "Flashcard generation returned an empty or invalid deck. Please try again.",
    );
  }

  if (userId && session) {
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        message: `Generate ${numCards} ${difficulty} flashcards.`,
      },
    });

    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        message: JSON.stringify(deck),
      },
    });

    await prisma.chatSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });
  }

  return {
    ...deck,
    session_id: session?.id || deck.session_id || null,
  };
};

const callAI = async (payload: any = {}) => {
  const formData = new FormData();

  formData.append(
    "messages",
    typeof payload.messages === "string"
      ? payload.messages
      : payload.messages?.[0]?.content || "",
  );

  formData.append(
    "context",
    typeof payload.context === "string"
      ? payload.context
      : JSON.stringify(payload.context || {}),
  );

  if (payload.session_id) {
    formData.append("session_id", payload.session_id);
  }

  if (payload.file) {
    formData.append("file", payload.file.buffer, payload.file.originalname);
  }

  try {
    const response = await axios.post(
      `${process.env.AI_BASE_URL}/chat`,
      formData,
      {
        headers: formData.getHeaders(),
        maxBodyLength: Infinity,
        timeout: 120000,
      },
    );
    return response.data;
  } catch (error: any) {
    throw mapAiProxyError(error, "AI chat");
  }
};

// 🔥 GET ALL SESSIONS
const getChatSessions = async (userId: string) => {
  return prisma.chatSession.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      isoStandardId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
};

// 🔥 GET ISO BASED SESSIONS
const getSessionsByISO = async (userId: string, isoStandardId: string) => {
  return prisma.chatSession.findMany({
    where: {
      userId,
      isoStandardId,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  });
};

// 🔥 GET CHAT HISTORY
const getChatHistory = async (sessionId: string) => {
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      message: true,
      sources: true,
      followUps: true,
      createdAt: true,
    },
  });

  return messages.map((m) => {
    let parsedMessage: any = m.message;
    if (m.message && (m.message.trim().startsWith("{") || m.message.trim().startsWith("["))) {
      try {
        parsedMessage = JSON.parse(m.message);
      } catch {
        parsedMessage = m.message;
      }
    }
    return {
      ...m,
      message: parsedMessage,
    };
  });
};

const mapAiProxyError = (error: any, fallbackMessage: string) => {
  if (error?.code === "ECONNABORTED") {
    return new ApiError(
      httpStatus.GATEWAY_TIMEOUT,
      `${fallbackMessage} timed out. Please try again.`,
    );
  }
  if (
    error?.code === "ECONNREFUSED" ||
    error?.code === "ENOTFOUND" ||
    error?.code === "ETIMEDOUT" ||
    error?.message?.includes("connect")
  ) {
    return new ApiError(
      httpStatus.BAD_GATEWAY,
      "AI service is unreachable. Please verify AI_BASE_URL and that the AI server is running.",
    );
  }
  const status = error?.response?.status || httpStatus.BAD_GATEWAY;
  const message =
    error?.response?.data?.message || error?.message || fallbackMessage;
  return new ApiError(status, message);
};

// 🔥 AUDIT CONTEXT — IMS options + latest Standards Library editions (e.g. 9001:2026)
const getAuditContext = async (payload: any = {}) => {
  try {
    const sourceText = String(payload?.text || payload?.url || "").trim();

    // Ask the external AI for both individual ISO options and IMS when relevant
    const aiPayload = {
      ...payload,
      prefer_integrated_management_systems: true,
      context_instruction:
        'Return BOTH: (1) separate options for each relevant individual ISO standard as their own criteria, AND (2) when Integrated Management Systems / multiple standards are relevant, also include one option whose criteria is explicitly labeled "Integrated Management Systems" listing those standards together. Keep individual ISO options — do not replace them with only an IMS option. Prefer the latest published edition year for each ISO family when known (do not default every option to 2015).',
    };

    const response = await axios.post(
      `${process.env.AI_BASE_URL}/audit-lens/context`,
      aiPayload,
      { timeout: 60000 },
    );

    // 1) Normalize AI options
    // 2) Ensure IMS + individual standards are both present
    // 3) Remap edition years to latest ACTIVE Standards Library (IMS-safe rewrite)
    const normalized = normalizeAuditContextResponse(response.data);
    const withIms = ensureIntegratedManagementSystemsOptions(
      normalized,
      sourceText,
    );

    try {
      const library = await prisma.iSOStandard.findMany({
        where: { status: "ACTIVE" },
        select: { title: true },
        take: 200,
      });
      return applyLatestLibraryEditionsToPayload(withIms, library);
    } catch {
      return withIms;
    }
  } catch (error: any) {
    throw mapAiProxyError(error, "Audit context generation");
  }
};

// 🔥 AUDIT STEP — guidance assistant (does not simulate conducting the audit)
const getAuditStep = async (payload: any = {}) => {
  const stepNumber = Number(payload.step_number || payload.stepNumber || 0);
  if (!stepNumber || stepNumber < 1 || stepNumber > 13) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Valid step_number (1–13) is required for Audit Lens.",
    );
  }

  const t0 = Date.now();
  const mark = (phase: string, startedAt: number) => {
    console.log(
      `[AuditLens][timing] step=${stepNumber} ${phase}=${Date.now() - startedAt}ms elapsed=${Date.now() - t0}ms`,
    );
  };

  const meta = AUDIT_STEP_META[stepNumber];
  const stepTitle = String(payload.step_title || payload.stepTitle || meta?.title || "").trim();
  const stage = String(payload.stage || meta?.stage || "Plan").trim();
  let lockedContext = payload.locked_context ?? payload.lockedContext ?? {};

  // Case Study is independent of edition remap + PDF grounding — start immediately
  // so it overlaps remap, grounding, and /audit-lens/step.
  const casePromise = generateAuditCaseStudyViaChat({
    stepNumber,
    stepTitle: stepTitle || meta.title,
    stage,
    lockedContext,
  }).catch((err: any) => {
    console.warn(
      "[AuditLens] Case Study /chat fill failed:",
      err?.message || err,
    );
    return "";
  });

  // Align locked criteria/standard labels with latest ACTIVE library edition
  const tLib = Date.now();
  try {
    const library = await prisma.iSOStandard.findMany({
      where: { status: "ACTIVE" },
      select: { title: true },
      take: 200,
    });
    if (library.length && lockedContext && typeof lockedContext === "object") {
      lockedContext = applyLatestLibraryEditionsToPayload(lockedContext, library);
    }
  } catch {
    // never block on edition remap
  }
  mark("library_remap", tLib);

  // Bounded library grounding — run ISO + guideline retrieval in parallel
  let groundingExcerpt = "";
  let guidelineExcerpt = "";
  const tGround = Date.now();
  try {
    const criteria = String(
      (typeof lockedContext === "object" &&
        (lockedContext.criteria ||
          lockedContext.standard ||
          lockedContext.iso ||
          lockedContext.iso_standard)) ||
        "",
    ).trim();
    const clause = String(
      (typeof lockedContext === "object" &&
        (lockedContext.clause ||
          lockedContext.requirement ||
          lockedContext.relevant_clause)) ||
        "",
    ).trim();

    const groundingWork = Promise.all([
      criteria.length >= 5
        ? getNavigatorGroundingExcerpt({
            specificRequirements: criteria,
            clause: clause || undefined,
            // Audit Lens already pulls ISO + 19011 guideline in parallel —
            // skip extra supporting-doc PDF download on the hot path.
            skipSupporting: true,
          })
        : Promise.resolve({ excerpt: "" }),
      getAuditGuidelineExcerpt({
        criteria,
        stepTitle: stepTitle || meta?.title,
      }),
    ]);

    const [grounding, guideline] = await groundingWork;
    groundingExcerpt = (grounding.excerpt || "").slice(0, 4000);
    guidelineExcerpt = (guideline.excerpt || "").slice(0, 2500);
  } catch {
    // never block step generation on grounding failure
  }
  mark("grounding", tGround);

  const generation_instructions = buildAuditStepInstructions({
    stepNumber,
    stepTitle,
    stage,
    lockedContext,
    groundingExcerpt: groundingExcerpt || undefined,
    guidelineExcerpt: guidelineExcerpt || undefined,
  });

  const folded = foldAuditInstructionsIntoPayload({
    lockedContext,
    stepNumber,
    stepTitle: stepTitle || meta.title,
    stage,
    instructions: generation_instructions,
  });

  const aiPayload: Record<string, unknown> = {
    ...folded,
    grounding_excerpt: groundingExcerpt || undefined,
    guideline_excerpt: guidelineExcerpt || undefined,
  };
  Object.keys(aiPayload).forEach((key) => {
    if (aiPayload[key] === undefined || aiPayload[key] === "") {
      delete aiPayload[key];
    }
  });

  const callStep = async (body: Record<string, unknown>) => {
    try {
      const response = await axios.post(
        `${process.env.AI_BASE_URL}/audit-lens/step`,
        body,
        { timeout: 90000 },
      );
      return response.data;
    } catch (error: any) {
      const detailRaw = error?.response?.data;
      const detail =
        typeof detailRaw === "string"
          ? detailRaw.slice(0, 400)
          : JSON.stringify(detailRaw ?? {}).slice(0, 400);
      console.warn(
        `[AuditLens] /audit-lens/step failed status=${error?.response?.status} detail=${detail}`,
      );
      throw mapAiProxyError(error, "Audit step generation");
    }
  };

  const tStep = Date.now();
  let raw = await callStep(aiPayload);
  mark("ai_step", tStep);

  let normalized = normalizeAuditStepResponse(raw, {
    stepNumber,
    stepTitle: stepTitle || meta.title,
    stage,
  });

  if (!isValidAuditGuidance(normalized.guidance)) {
    const tRetry = Date.now();
    raw = await callStep({
      ...aiPayload,
      retry: true,
      generation_instructions: `${generation_instructions}\n\nIMPORTANT: Previous response was empty or invalid. Return non-empty markdown guidance with the required Audit Step / Auditor Guidance / Audit Paper / Template / Case Study (Hypothetical) sections. Do NOT simulate conducting the audit or invent findings.`,
    });
    mark("ai_step_retry", tRetry);
    normalized = normalizeAuditStepResponse(raw, {
      stepNumber,
      stepTitle: stepTitle || meta.title,
      stage,
    });
  }

  if (!isValidAuditGuidance(normalized.guidance)) {
    // Still await/cancel work — don't leave hanging promise unhandled beyond catch
    void casePromise;
    throw new ApiError(
      httpStatus.BAD_GATEWAY,
      "Audit Lens returned empty or invalid step guidance. Please try again.",
    );
  }

  // Runtime evidence (2026-09-25): /audit-lens/step returns only
  // {guidance, template_preview, ...} work-paper content — never case_study and
  // never a "## 4. Demonstrated Case Study" heading (even on retry). The /chat
  // endpoint does return a real Case Study when asked. Fill only when missing.
  // Case Study was started in parallel above — await residual time only.
  if (!hasAuditCaseStudyContent(normalized)) {
    const tCase = Date.now();
    try {
      const caseMarkdown = await casePromise;
      mark("ai_case_await", tCase);
      if (caseMarkdown.trim().length >= 40) {
        let body = caseMarkdown.trim();
        const sectionMatch = body.match(
          /##\s*\d*\.?\s*demonstrated\s+case\s+study\b[^\n]*\n+([\s\S]*)/i,
        );
        if (sectionMatch?.[1]?.trim()) body = sectionMatch[1].trim();
        const labeled = ensureHypotheticalCaseStudyLabel(body) || body;
        normalized = {
          ...normalized,
          case_study: labeled,
          guidance: /demonstrated\s+case\s+study/i.test(normalized.guidance || "")
            ? normalized.guidance
            : `${normalized.guidance}\n\n## 4. Demonstrated Case Study\n\n${labeled}`,
        };
      }
    } catch (err: any) {
      // Do not fail the whole step — Working Paper / Template remain usable.
      console.warn(
        "[AuditLens] Case Study /chat fill failed:",
        err?.message || err,
      );
    }
  } else {
    void casePromise;
  }

  mark("total", t0);
  return normalized;
};

/**
 * /audit-lens/step is locked to work-paper output. Use /chat to obtain the
 * Demonstrated Case Study when the step response omits it.
 */
const generateAuditCaseStudyViaChat = async (params: {
  stepNumber: number;
  stepTitle: string;
  stage: string;
  lockedContext: any;
}): Promise<string> => {
  const ctx = params.lockedContext || {};
  const org =
    ctx.organization ||
    ctx.organization_name ||
    ctx.client ||
    "the audited organization";
  const criteria = ctx.criteria || ctx.standard || "the applicable ISO standard";
  const scope = ctx.scope || "the defined audit scope";

  const prompt = [
    `Write an educational Demonstrated Case Study for Audit Lens step ${params.stepNumber}: ${params.stepTitle} (${params.stage}).`,
    `Setting only (do not invent real findings): organization=${org}; criteria=${criteria}; scope=${scope}.`,
    "Use this exact markdown structure:",
    "## 4. Demonstrated Case Study",
    "**Demonstrated Case Study — Hypothetical Example (Not Actual Audit Evidence)**",
    "### The Situation",
    "### The Complication",
    "### The Auditor's Action",
    "Keep it educational and hypothetical. Do not claim real interviews, inspections, or compliance outcomes.",
  ].join("\n");

  const formData = new FormData();
  formData.append("messages", prompt);
  formData.append(
    "context",
    JSON.stringify({
      purpose: "audit_lens_case_study",
      step_number: params.stepNumber,
      step_title: params.stepTitle,
      stage: params.stage,
    }),
  );

  const response = await axios.post(
    `${process.env.AI_BASE_URL}/chat`,
    formData,
    {
      headers: formData.getHeaders(),
      timeout: 90000,
    },
  );
  const data = response.data;
  return String(
    data?.response ||
      data?.reply ||
      data?.message ||
      data?.content ||
      data?.guidance ||
      data?.data?.response ||
      data?.data?.content ||
      "",
  ).trim();
};

const analyzeBenchmarkFile = async (file: any, payload: any = {}) => {
  const formData = new FormData();

  formData.append("file", file.buffer, file.originalname);
  formData.append("improvement_goal", payload.improvement_goal);
  formData.append("target_standard", payload.target_standard);
  formData.append("document_type", payload.document_type || "Unknown");
  formData.append("department", payload.department || "");

  const response = await axios.post(
    `${process.env.AI_BASE_URL}/benchmark/analyze-file`,
    formData,
    {
      headers: formData.getHeaders(),
    },
  );

  return response.data;
};

const analyzeBenchmarkText = async (payload: any = {}) => {
  const response = await axios.post(
    `${process.env.AI_BASE_URL}/benchmark/analyze-text`,
    payload,
  );

  return response.data;
};

// 🔥 CONTEXT GENERATOR
const generateContext = async (payload: any = {}) => {
  try {
    const response = await axios.post(
      `${process.env.AI_BASE_URL}/discovery/context-generator`,
      payload,
      { timeout: CONTEXT_GENERATOR_TIMEOUT_MS },
    );
    return response.data;
  } catch (error: any) {
    if (error?.code === "ECONNABORTED") {
      throw new ApiError(
        httpStatus.GATEWAY_TIMEOUT,
        "Context generation timed out. Please try again.",
      );
    }
    if (
      error?.code === "ECONNREFUSED" ||
      error?.code === "ENOTFOUND" ||
      error?.code === "ETIMEDOUT" ||
      error?.message?.includes("connect")
    ) {
      throw new ApiError(
        httpStatus.BAD_GATEWAY,
        "AI service is unreachable. Please verify AI_BASE_URL and that the AI server is running.",
      );
    }
    const status = error?.response?.status || httpStatus.BAD_GATEWAY;
    const message =
      error?.response?.data?.message ||
      error?.message ||
      "Context generation failed";
    throw new ApiError(status, message);
  }
};

// 🔥 ISO SUGGESTIONS
const getISOSuggestions = async (payload: any = {}) => {
  try {
    const response = await axios.post(
      `${process.env.AI_BASE_URL}/discovery/iso-suggestions`,
      payload,
      { timeout: ISO_SUGGESTIONS_TIMEOUT_MS },
    );
    const library = await prisma.iSOStandard.findMany({
      where: { status: "ACTIVE" },
      select: { title: true },
      take: 200,
    });
    const sourceText = [
      payload.category,
      payload.organization_context,
      payload.context,
      typeof payload.organization_context === "object"
        ? JSON.stringify(payload.organization_context)
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    // 1) Remap editions to latest ACTIVE library (IMS-safe multi-token rewrite)
    // 2) Ensure IMS suggestion is present when multiple standards apply
    const withEditions = applyLatestLibraryEditionsToPayload(
      response.data,
      library,
      { dropUnavailableFamilies: true },
    );
    return ensureNavigatorImsSuggestions(withEditions, sourceText, library);
  } catch (error: any) {
    if (error?.code === "ECONNABORTED") {
      throw new ApiError(
        httpStatus.GATEWAY_TIMEOUT,
        "ISO suggestions timed out. Please try again.",
      );
    }
    if (
      error?.code === "ECONNREFUSED" ||
      error?.code === "ENOTFOUND" ||
      error?.code === "ETIMEDOUT" ||
      error?.message?.includes("connect")
    ) {
      throw new ApiError(
        httpStatus.BAD_GATEWAY,
        "AI service is unreachable. Please verify AI_BASE_URL and that the AI server is running.",
      );
    }
    const status = error?.response?.status || httpStatus.BAD_GATEWAY;
    const message =
      error?.response?.data?.message ||
      error?.message ||
      "ISO suggestions failed";
    throw new ApiError(status, message);
  }
};

const getBenchmarkAISuggestions = async (
  payload: any = {},
  file?: Express.Multer.File,
) => {
  const formData = new FormData();

  // 🔥 category
  formData.append("category", payload.category);

  // 🔥 optional file
  if (file) {
    formData.append("file", file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
  }

  const response = await axios.post(
    `${process.env.AI_BASE_URL}/discovery/iso-suggestions`,
    formData,
    {
      headers: formData.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: ISO_SUGGESTIONS_TIMEOUT_MS,
    },
  );

  return response.data;
};

const generateFollowup = async (payload: any = {}) => {
  const context =
    payload?.context && typeof payload.context === "object"
      ? { ...payload.context }
      : typeof payload?.context === "string"
        ? (() => {
            try {
              return JSON.parse(payload.context);
            } catch {
              return {};
            }
          })()
        : {};

  const topic = String(context.topic || payload?.topic || "the selected ISO standard");
  const enriched = {
    ...payload,
    context: {
      ...context,
      topic,
      details: [
        String(context.details || ""),
        `Generate difficult exam-style follow-up questions specifically about ${topic}.`,
        "Each question must be direct, technical, and answerable from the standard (purpose, evidence, responsibilities, documented information, implementation).",
        "Do NOT generate open-ended coaching prompts such as: What is your scope?, What do you know about…, Can you explain…, How would you define…, What is ISO…?",
        "Return only exam-style questions.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    num_questions: payload?.num_questions || 5,
  };

  try {
    const response = await axios.post(
      `${process.env.AI_BASE_URL}/quiz/followup`,
      enriched,
      { timeout: 60000 },
    );

    const data = response.data;
    const questionsRaw =
      data?.data?.questions ||
      data?.questions ||
      data?.data?.followups ||
      [];
    if (Array.isArray(questionsRaw)) {
      const filtered = questionsRaw
        .map((q: any) => String(q || "").trim())
        .filter((q: string) => {
          if (q.length < 12) return false;
          const lower = q.toLowerCase();
          if (/^what is your scope\b/.test(lower)) return false;
          if (/^what do you know\b/.test(lower)) return false;
          if (/^can you explain\b/.test(lower)) return false;
          if (/^how would you define\b/.test(lower)) return false;
          if (/^tell me about\b/.test(lower)) return false;
          if (/^what is iso\b/.test(lower)) return false;
          return true;
        })
        .slice(0, 5);

      if (data?.data && typeof data.data === "object") {
        return { ...data, data: { ...data.data, questions: filtered } };
      }
      return { ...data, questions: filtered, data: { questions: filtered } };
    }
    return data;
  } catch (error: any) {
    throw mapAiProxyError(error, "Follow-up question generation");
  }
};

export const AIAssistantService = {
  generateISO,
  simpleChat,
  chat,
  generateFlashcards,
  getChatSessions,
  getChatHistory,
  getSessionsByISO,
  getAuditContext,
  getAuditStep,
  analyzeBenchmarkFile,
  analyzeBenchmarkText,
  generateContext,
  getISOSuggestions,
  getBenchmarkAISuggestions,
  generateFollowup,
};
