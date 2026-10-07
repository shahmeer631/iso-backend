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
import { looksLikeNavigatorImsAnalysisQuestion, isNavigatorChatContext, buildNavigatorChatGrounding } from "./navigatorChat";
import {
  applyLatestLibraryEditionsToPayload,
} from "./isoStandardVersion";
import {
  collectImsIntegrationStandardTokens,
  ensureNavigatorImsSuggestions,
  looksLikeImsRequirement as looksLikeNavigatorImsLabel,
} from "./navigatorIms";
import {
  buildImsDocumentedInformationInventory,
  imsSuggestionNeedsDocumentInventory,
} from "./navigatorImsDocuments";
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
  extractClauseKeyFromQuestion,
  LEARNING_BRIEF_HEADER,
} from "./courseLearning.grounding";
import {
  LIBRARY_BRIEF_HEADER,
  LIBRARY_FLASHCARD_INSTRUCTION,
  LIBRARY_STARTER_QUESTION_COUNT,
  LIBRARY_STUDIO_QUESTION_COUNT,
  buildLibraryAvailableSources,
  buildLibraryTaskInstructions,
  computeIsoExtractCoverage,
  countLibraryQuizQuestions,
  excerptDocumentedInformationGroundingFromBuffer,
  excerptExamStudyGroundingFromBuffer,
  excerptAskAiQuestionSeedFromBuffer,
  excerptIsoOverviewFromBuffer,
  debugChunksForExcerpt,
  excerptMultiWindowChatGroundingFromBuffer,
  filterExamStyleQuestions,
  getLibraryRelatedDocumentExcerpt,
  isDocumentedInformationInventoryQuestion,
  isStrongIsoFocusExcerpt,
  isUnusableLibraryStudioResponse,
  IsoExtractCoverage,
  LibraryRagChunkDebug,
  logLibraryRagDebug,
  normalizeLibraryFlashcardDeck,
  parseGeneratedExamQuestions,
  resolveLibraryTask,
  sanitizeLibraryAssistantText,
} from "./libraryStandards.grounding";
import {
  buildUniversalAskGrounding,
  isUniversalAskContext,
  isUniversalAskGreeting,
  isVagueDocumentChatQuestion,
  sanitizeUniversalAskClientContext,
  sanitizeUniversalAskResponse,
  UNIVERSAL_ASK_GREETING_REPLY,
  UNIVERSAL_ASK_VAGUE_QUESTION_REPLY,
} from "./universalAsk.grounding";
import {
  extractCachedIsoPdfText,
  getCachedIsoPdfBuffer,
  isoPdfBufferCacheKey,
  isoPdfUrlCacheKey,
} from "./isoPdfCache";

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
  // Preserve explicit edition years from the Navigator selection (version isolation).
  // Do NOT rewrite IMS labels to "latest" library editions — that mixes years.
  let specific_requirements = specific_requirements_raw;
  if (isIms) {
    specific_requirements = specific_requirements_raw;
    console.log(
      `[Navigator] IMS context preserved as-selected (exact editions): "${specific_requirements}"`,
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

  const navigatorQueryHints = [
    document_title,
    output_type,
    document_taxonomy || "",
    isIms || looksLikeNavigatorImsAnalysisQuestion(document_title)
      ? "integrated management system documented information maintain retain mandatory documents records common requirements standard-specific"
      : "documented information maintain retain mandatory documents records requirements",
  ]
    .filter(Boolean)
    .join(" ");

  const grounding = await getNavigatorGroundingExcerpt({
    specificRequirements: specific_requirements,
    clause,
    documentTitle: document_title,
    queryHints: navigatorQueryHints,
  });

  if (isIms && grounding.imsGuideAvailable !== true) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Integrated Management System – A Practical Guide (IMS PG) was not found in the Documents/Standards Library. Upload the IMS Practical Guide before generating IMS documented information. Generation was not started with a generic substitute.",
    );
  }

  if (isIms) {
    const imsTokens = collectImsIntegrationStandardTokens(specific_requirements);
    const groundedIsoSources = (grounding.groundingSources || []).filter(
      (s) =>
        s.mode !== "ims_guide" &&
        !/practical\s+guide|integrated\s+management\s+system/i.test(
          String(s.standard || ""),
        ),
    );
    if (
      imsTokens.length > 0 &&
      groundedIsoSources.length === 0 &&
      (!grounding.excerpt || !/ISO STANDARD\s*\(/i.test(grounding.excerpt))
    ) {
      const missing =
        grounding.missingEditions && grounding.missingEditions.length > 0
          ? grounding.missingEditions.join("; ")
          : imsTokens.join(", ");
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `None of the selected ISO standards for this IMS could be retrieved from the Standards Library (requested: ${missing}). No silent substitution was applied.`,
      );
    }
  }

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

  if (grounding.groundingSources?.length) {
    for (const src of grounding.groundingSources) {
      console.log(
        `[Navigator][source] standard="${src.standard}" id=${src.documentId || "n/a"} pages=${src.pageCount ?? "?"} extractedChars=${src.extractedChars ?? "?"} mode=${src.mode || "n/a"} retrievedPages=${(src.retrievedPages || []).join(",") || "n/a"} coverage=${src.coverage ? `early=${src.coverage.hasEarlyClause}/mid=${src.coverage.hasMidClause}/late=${src.coverage.hasLateClause}/docInfo=${src.coverage.hasDocumentedInformation}` : "n/a"}`,
      );
    }
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
    isIms: grounding.isIms || isIms,
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

  if (isIms || grounding.isIms) {
    aiPayload.is_ims = true;
    const imsTokens = collectImsIntegrationStandardTokens(specific_requirements);
    if (imsTokens.length) {
      aiPayload.ims_integration_standards = imsTokens;
    }
    if (grounding.imsGuideTitle) {
      aiPayload.ims_guide_title = grounding.imsGuideTitle;
    }
  }

  // Remove undefined keys to keep payload compact
  Object.keys(aiPayload).forEach((key) => {
    if (aiPayload[key] === undefined || aiPayload[key] === "") {
      delete aiPayload[key];
    }
  });

  const groundingSourcesForClient = (grounding.groundingSources || [])
    .filter((s) => s.standard)
    .map((s) => ({
      standard: s.standard,
      version: s.version,
      page_count: s.pageCount,
      retrieved_pages: s.retrievedPages?.length ? s.retrievedPages : undefined,
      clauses: s.clauseHints?.length ? s.clauseHints : undefined,
      retrieval_mode: s.mode,
    }));

  const meta = {
    organization_context,
    tone,
    language,
    clause,
    document_taxonomy,
    iso_standard: specific_requirements,
    grounded_standard: grounding.standardTitle,
    is_ims: Boolean(grounding.isIms || isIms),
    ims_guide_title: grounding.imsGuideTitle,
    ims_guide_available: isIms ? grounding.imsGuideAvailable === true : undefined,
    missing_editions:
      grounding.missingEditions && grounding.missingEditions.length > 0
        ? grounding.missingEditions
        : undefined,
    grounding_sources:
      groundingSourcesForClient.length > 0
        ? groundingSourcesForClient
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

function isValidObjectIdForAsk(id: string) {
  return /^[a-fA-F0-9]{24}$/.test(id);
}

/** Document-grounded starter chips for Universal Ask AI (not Library workflow chat). */
async function runUniversalAskStarterQuestions(params: {
  isoStandardId: string;
  standardTitle?: string;
  sessionId?: string | null;
}) {
  const isoStandardId = params.isoStandardId;
  if (!isValidObjectIdForAsk(isoStandardId)) {
    return {
      response: "",
      suggested_followups: [] as string[],
      session_id: params.sessionId || null,
      purpose: "universal_ask",
      grounded: false,
      standard_title: null,
      standard_id: null,
      sources: [] as string[],
    };
  }

  const iso = await prisma.iSOStandard.findFirst({
    where: { id: isoStandardId, status: "ACTIVE" },
    select: { id: true, title: true, fileUrl: true },
  });
  if (!iso?.fileUrl) {
    return {
      response: "",
      suggested_followups: [] as string[],
      session_id: params.sessionId || null,
      purpose: "universal_ask",
      grounded: false,
      standard_title: iso?.title || null,
      standard_id: iso?.id || null,
      sources: [] as string[],
    };
  }

  const cached = await getCachedIsoPdfBuffer(iso.fileUrl, { timeoutMs: 25000 });
  if (!cached) {
    return {
      response: "",
      suggested_followups: [] as string[],
      session_id: params.sessionId || null,
      purpose: "universal_ask",
      grounded: false,
      standard_title: iso.title,
      standard_id: iso.id,
      sources: [] as string[],
    };
  }

  const cacheKey = isoPdfUrlCacheKey(iso.fileUrl);
  const seed = await excerptAskAiQuestionSeedFromBuffer(cached.buffer, {
    cacheKey,
  });
  if (!seed || seed.length < 200) {
    return {
      response: "",
      suggested_followups: [] as string[],
      session_id: params.sessionId || null,
      purpose: "universal_ask",
      grounded: false,
      standard_title: iso.title,
      standard_id: iso.id,
      sources: [iso.title],
    };
  }

  const brief = [
    "You are ISOBrain Ask AI — generate starter questions for document chat over an uploaded standard.",
    "Using ONLY the REFERENCE MATERIAL below, write exactly 5 short exam-style questions a user might ask about this document.",
    "Each question must be specific enough to answer from the material. No generic ISO marketing questions. No ISOBrain module questions.",
    "Output only a numbered list (1. ... through 5.).",
    `STANDARD: ${params.standardTitle || iso.title}`,
    `REFERENCE MATERIAL:\n${seed}`,
  ].join("\n\n");

  const aiResponse = await callAI({
    messages: brief,
    context: {
      purpose: "universal_ask",
      instruction:
        "Generate numbered document-grounded starter questions only. Do not answer them.",
    },
    session_id: params.sessionId || undefined,
  });

  const qs = parseGeneratedExamQuestions(String(aiResponse?.response || ""), 5);
  const cleaned = filterExamStyleQuestions(qs, 5);
  return {
    response: cleaned.map((q, i) => `${i + 1}. ${q}`).join("\n"),
    suggested_followups: cleaned,
    session_id: params.sessionId || null,
    purpose: "universal_ask",
    grounded: cleaned.length > 0,
    standard_title: iso.title,
    standard_id: iso.id,
    sources: cleaned.length ? [iso.title] : [],
  };
}

const simpleChat = async (userId: string | undefined, payload: any = {}) => {
  // Parse context once — used for Universal Ask routing without breaking
  // Navigator / Audit Lens / Benchmark callers that pass their own document context.
  let parsedContext: any = {};
  if (typeof payload.context === "string") {
    try {
      parsedContext = JSON.parse(payload.context);
    } catch {
      parsedContext = {};
    }
  } else {
    parsedContext = payload.context || {};
  }

  const questionText =
    typeof payload.messages === "string"
      ? payload.messages
      : payload.messages?.[0]?.content || payload.question || "";

  // ── Universal Ask AI: ground in ISO + Library before calling the shared /chat engine
  if (isUniversalAskContext(parsedContext)) {
    const t0 = Date.now();

    // Greetings / tiny chitchat — never run RAG or return a knowledge-base miss
    if (isUniversalAskGreeting(questionText)) {
      console.log(
        `[UniversalAsk] greeting total=${Date.now() - t0}ms user=${userId || "guest"}`,
      );
      return {
        response: UNIVERSAL_ASK_GREETING_REPLY,
        sources: [],
        session_id: payload.session_id || null,
        purpose: "universal_ask",
        grounded: false,
        standard_title: null,
        standard_id: null,
      };
    }

    // Placeholder / template prompts (e.g. "Explain a specific clause…") — guide the user
    if (isVagueDocumentChatQuestion(questionText)) {
      console.log(
        `[UniversalAsk] vague_question total=${Date.now() - t0}ms user=${userId || "guest"}`,
      );
      return {
        response: UNIVERSAL_ASK_VAGUE_QUESTION_REPLY,
        sources: [],
        session_id: payload.session_id || null,
        purpose: "universal_ask",
        grounded: false,
        standard_title: null,
        standard_id: null,
      };
    }

    const safeContext = sanitizeUniversalAskClientContext(parsedContext);

    if (
      safeContext.task === "document_starter_questions" &&
      typeof safeContext.isoStandardId === "string"
    ) {
      return runUniversalAskStarterQuestions({
        isoStandardId: safeContext.isoStandardId,
        standardTitle:
          typeof safeContext.standardTitle === "string"
            ? safeContext.standardTitle
            : undefined,
        sessionId: payload.session_id || null,
      });
    }

    const grounding = await buildUniversalAskGrounding({
      question: questionText,
      isoStandardId:
        typeof safeContext.isoStandardId === "string"
          ? safeContext.isoStandardId
          : typeof safeContext.standardId === "string"
            ? safeContext.standardId
            : undefined,
      standardTitle:
        typeof safeContext.standardTitle === "string"
          ? safeContext.standardTitle
          : undefined,
      standardCode:
        typeof safeContext.standardCode === "string"
          ? safeContext.standardCode
          : typeof safeContext.isoCode === "string"
            ? safeContext.isoCode
            : undefined,
      standardVersion:
        typeof safeContext.standardVersion === "string"
          ? safeContext.standardVersion
          : typeof safeContext.version === "string"
            ? safeContext.version
            : undefined,
      clause:
        typeof safeContext.clause === "string"
          ? safeContext.clause
          : typeof safeContext.clauseId === "string"
            ? safeContext.clauseId
            : undefined,
      documentId:
        typeof safeContext.documentId === "string"
          ? safeContext.documentId
          : undefined,
      conversationSnippet:
        typeof safeContext.conversationSnippet === "string"
          ? safeContext.conversationSnippet
          : undefined,
    });

    // No grounding → do not call the LLM with a fake "ISO-backed" answer
    if (!grounding.hasGrounding) {
      console.log(
        `[UniversalAsk] no_grounding total=${Date.now() - t0}ms retrieval=${grounding.retrievalMs}ms user=${userId || "guest"}`,
      );
      return {
        response:
          grounding.unavailableMessage ||
          "I couldn't find enough source material in the available ISOBrain library to give you a reliable answer to that specific point. Try naming a specific standard or topic.",
        sources: [],
        session_id: payload.session_id || null,
        purpose: "universal_ask",
        grounded: false,
        standard_title: null,
        standard_id: null,
      };
    }

    const remoteContext = {
      purpose: "universal_ask",
      isoStandardId: grounding.standardId || safeContext.isoStandardId || undefined,
      instruction:
        "Answer as ISOBrain Ask AI — a universal ISOBrain assistant. Use only the provided REFERENCE MATERIAL from the ISOBrain Library (and any connected documents). Answer the user's question directly and clearly. Do not invent multi-standard comparisons the sources do not support. Do not append 'could not find enough source material' after a useful grounded answer. Do not run Navigator, Audit Lens, or Expert Studio workflows. Only if the core question cannot be answered from the reference material, say briefly that you could not find enough source material in the available ISOBrain library — never say that 'uploaded documents' are insufficient, and never mention RAG/retrieval internals. Never invent ISO requirements. Never use internal system terminology.",
    };

    let aiResponse: any;
    const tAi = Date.now();
    try {
      aiResponse = await callAI({
        messages: grounding.brief,
        context: remoteContext,
        session_id: payload.session_id || undefined,
      });
    } catch (error: any) {
      console.error(
        `[UniversalAsk] AI provider failed user=${userId || "guest"} message=${error?.message || error}`,
      );
      throw error;
    }

    if (
      !aiResponse ||
      typeof aiResponse.response !== "string" ||
      !String(aiResponse.response).trim()
    ) {
      aiResponse = {
        ...(aiResponse || {}),
        response:
          "I couldn't find enough source material in the available ISOBrain library to give you a reliable answer to that specific point.",
        sources: grounding.sources,
      };
    } else {
      aiResponse.response = sanitizeUniversalAskResponse(
        sanitizeLibraryAssistantText(aiResponse.response),
      );
      // Only return sources that were actually retrieved — never remote-invented citations
      aiResponse.sources = grounding.sources.slice(0, 8);
    }

    console.log(
      `[UniversalAsk] total=${Date.now() - t0}ms retrieval=${grounding.retrievalMs}ms ai=${Date.now() - tAi}ms user=${userId || "guest"} standard=${grounding.standardTitle || "n/a"} sources=${(aiResponse.sources || []).length}`,
    );

    return {
      ...aiResponse,
      session_id: payload.session_id || null,
      purpose: "universal_ask",
      grounded: true,
      standard_title: grounding.standardTitle || null,
      standard_id: grounding.standardId || null,
    };
  }

  // ── ISO Navigator chat: document-grounded IMS / standard Q&A (not Universal Ask AI)
  if (isNavigatorChatContext(parsedContext)) {
    const t0 = Date.now();
    const grounding = await buildNavigatorChatGrounding({
      question: questionText,
      specificRequirements:
        typeof parsedContext.specific_requirements === "string"
          ? parsedContext.specific_requirements
          : typeof parsedContext.iso_standard === "string"
            ? parsedContext.iso_standard
            : undefined,
      organizationContext:
        typeof parsedContext.organization_context === "string"
          ? parsedContext.organization_context
          : undefined,
      documentTitle:
        typeof parsedContext.document_title === "string"
          ? parsedContext.document_title
          : undefined,
      clause:
        typeof parsedContext.clause === "string"
          ? parsedContext.clause
          : undefined,
      generatedDocumentSnippet:
        typeof parsedContext.full_document_context === "string"
          ? parsedContext.full_document_context
          : typeof parsedContext.generated_document === "string"
            ? parsedContext.generated_document
            : undefined,
    });

    if (!grounding.hasGrounding) {
      console.log(
        `[NavigatorChat] no_grounding total=${Date.now() - t0}ms retrieval=${grounding.retrievalMs}ms user=${userId || "guest"}`,
      );
      return {
        response:
          "I couldn't retrieve enough material from the selected Standards Library editions for this question. Select an ISO standard or Integrated Management Systems option in ISO Navigator, then ask again.",
        messages: [
          {
            role: "assistant",
            content:
              "I couldn't retrieve enough material from the selected Standards Library editions for this question. Select an ISO standard or Integrated Management Systems option in ISO Navigator, then ask again.",
          },
        ],
        sources: [],
        session_id: payload.session_id || null,
        purpose: "iso_navigator",
        grounded: false,
      };
    }

    let aiResponse: any;
    const tAi = Date.now();
    try {
      aiResponse = await callAI({
        messages: grounding.brief,
        context: {
          purpose: "iso_navigator",
          instruction:
            "Answer as ISOBrain ISO Navigator. Use only the provided authoritative source material from uploaded Standards Library / IMS guide excerpts plus organization context. For IMS questions, analyze selected standards together — do not concatenate independent document lists. Do not invent requirements. Never use internal system terminology.",
        },
        session_id: payload.session_id || undefined,
      });
    } catch (error: any) {
      console.error(
        `[NavigatorChat] AI provider failed user=${userId || "guest"} message=${error?.message || error}`,
      );
      throw mapAiProxyError(error, "ISO Navigator chat");
    }

    const answer =
      typeof aiResponse?.response === "string" && aiResponse.response.trim()
        ? sanitizeLibraryAssistantText(aiResponse.response)
        : "The available source material does not provide enough information to answer this reliably.";

    console.log(
      `[NavigatorChat] total=${Date.now() - t0}ms retrieval=${grounding.retrievalMs}ms ai=${Date.now() - tAi}ms user=${userId || "guest"} ims=${grounding.isIms} sources=${grounding.sources.length}`,
    );

    return {
      ...(aiResponse || {}),
      response: answer,
      messages: [{ role: "assistant", content: answer }],
      sources: grounding.sources.slice(0, 10),
      session_id: payload.session_id || null,
      purpose: "iso_navigator",
      grounded: true,
      standard_title: grounding.standardTitle || null,
      is_ims: grounding.isIms,
    };
  }

  // ── Default simpleChat pass-through (Audit Lens / Benchmark / legacy)
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

/** User-visible session / chat labels for Expert Studio library tasks (never expose internal prompts). */
const libraryTaskVisibleLabel = (task: string): string | null => {
  switch (task) {
    case "notes":
      return "Generating notes…";
    case "summary":
      return "Creating summary…";
    case "exam_questions":
      return "Generating questions…";
    case "quiz":
      return "Generating quiz…";
    case "eli5":
      return "Explaining simply…";
    case "flashcards":
      return "Generating flashcards…";
    case "starter_questions":
      return "Suggested study questions";
    default:
      return null;
  }
};

// Validate ObjectId
const isValidObjectId = (id: string) => {
  return /^[a-fA-F0-9]{24}$/.test(id);
};



const chat = async (userId: string, payload: any = {}) => {
  const tReq = Date.now();
  const latency: Record<string, number> = {};
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

  // Preserve / recover clause focus for Library chat (built-in chips often omit structured clause)
  if (
    finalContext?.purpose === "library_standards" ||
    finalContext?.isoStandardId
  ) {
    const fromContext = String(
      finalContext.clause || finalContext.clauseId || "",
    ).trim();
    const fromQuestion = extractClauseKeyFromQuestion(questionText || "");
    if (!fromContext && fromQuestion) {
      finalContext.clause = fromQuestion;
    } else if (fromContext) {
      finalContext.clause = fromContext.replace(/[^\d.]/g, "");
    }
  }

  const isoStandardId = finalContext?.isoStandardId;

  // Resolve library task early so session title / persistence can stay user-facing
  const earlyLibraryTask =
    finalContext?.purpose === "library_standards"
      ? resolveLibraryTask(finalContext, questionText || "")
      : "chat";
  const skipSessionPersistence =
    earlyLibraryTask === "starter_questions" && !session_id;
  const libraryVisibleLabel = libraryTaskVisibleLabel(earlyLibraryTask);

  // 🔥 2. ONLY logged user → session logic
  if (userId && !skipSessionPersistence) {
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
            libraryVisibleLabel ||
            (typeof messages === "string"
              ? generateTitle(messages)
              : typeof questionText === "string" && questionText
                ? generateTitle(questionText)
                : "New Chat"),
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
  let downloadedFile: { buffer: Buffer; originalname: string } | null = null;
  let isoFileAttachFailed = false;
  let pdfCacheHit = false;
  let pdfCacheKey: string | undefined;
  let attachMode: "full_pdf" | "excerpt_only" | "none" = "none";

  const tIso = Date.now();
  if (isoStandardId && isValidObjectId(isoStandardId)) {
    const iso = await prisma.iSOStandard.findUnique({
      where: { id: isoStandardId },
    });

    if (iso) {
      finalContext.isoStandard = {
        title: iso.title,
      };

      // Library Ask AI: mark purpose when not already a specialized grounded purpose
      if (
        finalContext.purpose !== "course_learning" &&
        finalContext.purpose !== "universal_ask" &&
        finalContext.purpose !== "library_standards"
      ) {
        finalContext.purpose = "library_standards";
      }
      if (
        finalContext.purpose === "library_standards" ||
        finalContext.purpose === "universal_ask"
      ) {
        finalContext.available_sources = buildLibraryAvailableSources(iso.title);
      }

      // Preserve Course Learning instruction when already set by enrichment.
      if (!finalContext.instruction) {
        finalContext.instruction =
          "Answer based on the provided ISO document content. Be specific and avoid generic answers. Do not invent clauses or editions.";
      }

      // Download file from DB if not provided by client (process-local URL cache)
      if (!payload.file && iso.fileUrl) {
        const tDl = Date.now();
        const cached = await getCachedIsoPdfBuffer(iso.fileUrl);
        latency.pdfDownloadMs = Date.now() - tDl;
        if (cached) {
          downloadedFile = {
            buffer: cached.buffer,
            originalname: cached.originalname,
          };
          pdfCacheHit = cached.cacheHit;
          pdfCacheKey = isoPdfUrlCacheKey(iso.fileUrl);
          finalContext.iso_file_attached = true;
        } else {
          isoFileAttachFailed = true;
          finalContext.iso_file_attached = false;
        }
      } else if (payload.file) {
        downloadedFile = payload.file;
        pdfCacheKey = isoPdfUrlCacheKey(
          String(iso.fileUrl || payload.file.originalname || "upload"),
        );
        finalContext.iso_file_attached = true;
      }
    } else {
      console.error(`[AIChat] ISO standard not found id=${isoStandardId}`);
    }
  }
  latency.isoResolveMs = Date.now() - tIso;

  console.log(
    `[AIChat] purpose=${finalContext?.purpose || "general"} iso=${isoStandardId || "n/a"} fileAttached=${Boolean(downloadedFile || payload.file)} session=${session?.id || "n/a"} pdfCache=${pdfCacheHit ? "hit" : "miss"}`,
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

  const excerptOpts = pdfCacheKey ? { cacheKey: pdfCacheKey } : undefined;

  const isInventoryQuestion =
    finalContext?.purpose === "library_standards" &&
    libraryTaskPreview === "chat" &&
    isDocumentedInformationInventoryQuestion(questionText || "");
  const ragDebugChunks: LibraryRagChunkDebug[] = [];
  let libraryRetrievalMode = "none";
  let libraryCoverage: IsoExtractCoverage | undefined;
  let libraryExtractedPdfChars = 0;

  const isoExcerptPromise = wantsClauseExcerpt
    ? (async () => {
        try {
          const explicitClause = String(
            finalContext?.clause ||
              finalContext?.clauseId ||
              finalContext?.relevant_clause ||
              "",
          )
            .replace(/[^\d.]/g, "")
            .replace(/^\.+|\.+$/g, "");

          // Coverage diagnostics over FULL extracted PDF text (early/mid/late).
          if (
            finalContext?.purpose === "library_standards" &&
            isoBufferForExcerpt
          ) {
            try {
              const cacheKey =
                excerptOpts?.cacheKey ||
                isoPdfBufferCacheKey(isoBufferForExcerpt);
              const { text } = await extractCachedIsoPdfText(
                cacheKey,
                isoBufferForExcerpt,
              );
              libraryExtractedPdfChars = (text || "").length;
              libraryCoverage = computeIsoExtractCoverage(text || "");
            } catch {
              /* diagnostics must never block chat */
            }
          }

          // Inventory / documented-information list questions: multi-window
          // retrieval across the selected standard PDF (not a single keyword hit).
          if (isInventoryQuestion && isoBufferForExcerpt) {
            const inventory =
              await excerptDocumentedInformationGroundingFromBuffer(
                isoBufferForExcerpt,
                questionText || "",
                { ...excerptOpts, debug: ragDebugChunks },
              );
            // Only keep strong inventory excerpts; weak early-page noise must not
            // dominate when the full PDF will be attached.
            if (
              inventory &&
              inventory.length > 200 &&
              isStrongIsoFocusExcerpt(inventory)
            ) {
              libraryRetrievalMode = "documented_information_inventory";
              return inventory;
            }
          }

          // Ask AI starter questions: seed from early/mid/late requirement windows
          // across the FULL selected standard (not first pages only).
          if (
            wantsStudyOverview &&
            libraryTaskPreview === "starter_questions"
          ) {
            const seed = await excerptAskAiQuestionSeedFromBuffer(
              isoBufferForExcerpt,
              { ...excerptOpts, debug: ragDebugChunks },
            );
            if (seed && seed.length > 200) {
              libraryRetrievalMode = "ask_ai_question_seed";
              return seed;
            }
          }

          // Studio tools (notes/summary/exam/quiz/flashcards): multi-theme
          // requirement windows across the FULL standard.
          if (
            wantsStudyOverview &&
            (libraryTaskPreview === "exam_questions" ||
              libraryTaskPreview === "quiz" ||
              libraryTaskPreview === "flashcards" ||
              libraryTaskPreview === "notes" ||
              libraryTaskPreview === "summary" ||
              libraryTaskPreview === "eli5")
          ) {
            const study = await excerptExamStudyGroundingFromBuffer(
              isoBufferForExcerpt,
              excerptOpts,
            );
            if (study && study.length > 200) {
              libraryRetrievalMode = "exam_study_multi_theme";
              return study;
            }
          }

          // Explicit / question-embedded clause → targeted window anywhere
          // in the full extract (not limited to early pages).
          const clauseFromQuestion =
            explicitClause ||
            extractClauseKeyFromQuestion(questionText || "") ||
            "";
          if (clauseFromQuestion) {
            const clauseExcerpt = await excerptLockedIsoFromBuffer(
              isoBufferForExcerpt,
              questionText,
              clauseFromQuestion,
              excerptOpts,
            );
            if (clauseExcerpt) {
              libraryRetrievalMode = "clause_window";
              try {
                const cacheKey =
                  excerptOpts?.cacheKey ||
                  isoPdfBufferCacheKey(isoBufferForExcerpt);
                const { text: fullText } = await extractCachedIsoPdfText(
                  cacheKey,
                  isoBufferForExcerpt,
                );
                const chunks = debugChunksForExcerpt(fullText, clauseExcerpt, {
                  score: 10,
                  clauseHint: clauseFromQuestion,
                });
                ragDebugChunks.length = 0;
                ragDebugChunks.push(...chunks);
              } catch {
                /* page diagnostics must never block chat */
              }
              return clauseExcerpt;
            }
          }

          // General Library chat: multi-window retrieval across ALL pages
          // (not a single keyword hit that can bias toward early pages).
          if (
            finalContext?.purpose === "library_standards" &&
            libraryTaskPreview === "chat" &&
            !wantsStudyOverview
          ) {
            const multi = await excerptMultiWindowChatGroundingFromBuffer(
              isoBufferForExcerpt,
              questionText || "",
              { ...excerptOpts, debug: ragDebugChunks },
            );
            if (multi && multi.length > 200 && isStrongIsoFocusExcerpt(multi)) {
              libraryRetrievalMode = "chat_multi_window";
              return multi;
            }
          }

          let excerpt = await excerptLockedIsoFromBuffer(
            isoBufferForExcerpt,
            questionText,
            explicitClause || undefined,
            excerptOpts,
          );
          if (excerpt) {
            libraryRetrievalMode = explicitClause
              ? "clause_window"
              : "keyword_window";
            if (!ragDebugChunks.length && isoBufferForExcerpt) {
              try {
                const cacheKey =
                  excerptOpts?.cacheKey ||
                  isoPdfBufferCacheKey(isoBufferForExcerpt);
                const { text: fullText } = await extractCachedIsoPdfText(
                  cacheKey,
                  isoBufferForExcerpt,
                );
                ragDebugChunks.push(
                  ...debugChunksForExcerpt(fullText, excerpt, {
                    score: 5,
                    clauseHint: clauseFromQuestion || undefined,
                  }),
                );
              } catch {
                /* ignore */
              }
            }
          }
          if (
            !excerpt &&
            (wantsStudyOverview || finalContext?.purpose === "library_standards")
          ) {
            if (wantsStudyOverview) {
              excerpt = await excerptExamStudyGroundingFromBuffer(
                isoBufferForExcerpt,
                excerptOpts,
              );
              if (excerpt) libraryRetrievalMode = "exam_study_multi_theme";
            }
            if (!excerpt) {
              excerpt = await excerptIsoOverviewFromBuffer(
                isoBufferForExcerpt,
                excerptOpts,
              );
              if (excerpt) libraryRetrievalMode = "overview_fallback";
            }
            if (
              excerpt &&
              !wantsStudyOverview &&
              !isInventoryQuestion &&
              libraryRetrievalMode !== "chat_multi_window"
            ) {
              excerpt = excerpt.slice(0, 2400);
            }
          }
          return excerpt || "";
        } catch (error) {
          console.error("ISO clause excerpt failed:", error);
          return "";
        }
      })()
    : Promise.resolve("");

  // Inventory questions must stay grounded in the selected ISO PDF — skip
  // secondary Documents Library material that can dilute requirements lists.
  const relatedDocPromise =
    finalContext?.purpose === "library_standards" &&
    finalContext.isoStandard?.title &&
    !finalContext.library_doc_excerpt &&
    // Study/studio tasks rely on the selected ISO excerpt — skip secondary
    // Documents Library PDF fetch (often 100ms–several seconds on Promise.all).
    libraryTaskPreview === "chat" &&
    !isInventoryQuestion
      ? Promise.race([
          getLibraryRelatedDocumentExcerpt({
            isoTitle: String(finalContext.isoStandard.title),
            question: questionText,
          }).catch((error) => {
            console.error("Library related document excerpt failed:", error);
            return { excerpt: "", title: undefined as string | undefined };
          }),
          new Promise<{ excerpt: string; title?: string }>((resolve) =>
            setTimeout(() => resolve({ excerpt: "" }), 900),
          ),
        ])
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
    const clauseHint = String(
      finalContext?.clause ||
        finalContext?.clauseId ||
        extractClauseKeyFromQuestion(questionText || "") ||
        "",
    );
    const extractedChars = String(finalContext.iso_clause_excerpt || "").length;
    console.log(
      `[Library][timing] grounding=${Date.now() - tLibraryGround}ms task=${libraryTaskPreview} mode=${libraryRetrievalMode || "n/a"} inventory=${isInventoryQuestion} isoExcerpt=${Boolean(finalContext.iso_clause_excerpt)} isoExcerptChars=${extractedChars} docExcerpt=${Boolean(finalContext.library_doc_excerpt)} clause=${clauseHint || "n/a"} fileAttached=${Boolean(downloadedFile || payload.file)} attachFailed=${isoFileAttachFailed} pdfCache=${pdfCacheHit ? "hit" : "miss"} downloadMs=${latency.pdfDownloadMs ?? 0}`,
    );
    finalContext._libraryRetrievalMode = libraryRetrievalMode;
    finalContext._libraryRagChunks = ragDebugChunks;
    finalContext._isInventoryQuestion = isInventoryQuestion;
    finalContext._libraryCoverage = libraryCoverage;
    finalContext._libraryExtractedPdfChars = libraryExtractedPdfChars;
    if (libraryCoverage) {
      const retrievedPages = [
        ...new Set(
          ragDebugChunks
            .map((c) => c.pageNumber)
            .filter((p): p is number => typeof p === "number" && p > 0),
        ),
      ].sort((a, b) => a - b);
      console.log(
        `[Library][coverage] standardId=${finalContext.isoStandardId || "n/a"} extractedChars=${libraryCoverage.extractedChars} indexedPages=${libraryCoverage.minPage}-${libraryCoverage.maxPage}/${libraryCoverage.pageCount || "?"} early=${libraryCoverage.hasEarlyClause}@p${libraryCoverage.earlyPage ?? "?"} mid=${libraryCoverage.hasMidClause}@p${libraryCoverage.midPage ?? "?"} late=${libraryCoverage.hasLateClause}@p${libraryCoverage.latePage ?? "?"} docInfo=${libraryCoverage.hasDocumentedInformation} retrievedPages=${retrievedPages.join(",") || "n/a"} mode=${libraryRetrievalMode || "n/a"}`,
      );
    }
  }
  latency.groundingMs = Date.now() - tLibraryGround;

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
    const studioQuestionCount = (() => {
      const n = Number(
        finalContext.question_count ??
          finalContext.num_questions ??
          finalContext.questionCount,
      );
      if (Number.isFinite(n) && n >= 5 && n <= 40) return Math.floor(n);
      return LIBRARY_STUDIO_QUESTION_COUNT;
    })();
    const excludeQuestions = (() => {
      const raw =
        finalContext.exclude_questions ||
        finalContext.excludeQuestions ||
        finalContext.previous_questions ||
        [];
      if (!Array.isArray(raw)) return [] as string[];
      return raw
        .map((q: unknown) => String(q || "").replace(/\s+/g, " ").trim())
        .filter((q: string) => q.length >= 12)
        .slice(0, 40);
    })();
    const taskInstructions = buildLibraryTaskInstructions(
      libraryTask,
      standardTitle,
      libraryTask === "quiz" || libraryTask === "exam_questions"
        ? {
            questionCount: studioQuestionCount,
            excludeQuestions,
          }
        : undefined,
    );
    // Stash for post-response validation / logging
    finalContext._studio_question_count = studioQuestionCount;
    finalContext._exclude_questions_count = excludeQuestions.length;

    const sourcesList = Array.isArray(finalContext.available_sources)
      ? finalContext.available_sources.join("; ")
      : "";

    const hasIsoExcerpt = Boolean(
      finalContext.iso_clause_excerpt &&
        String(finalContext.iso_clause_excerpt).trim().length > 40,
    );
    const excerptChars = String(finalContext.iso_clause_excerpt || "").trim()
      .length;
    // Inventory multi-window mode is chat-only — never override studio tasks
    // (starter questions / quiz / notes) even if the brief mentions "documented information".
    const inventoryMode =
      libraryTask === "chat" &&
      (finalContext._isInventoryQuestion === true ||
        isDocumentedInformationInventoryQuestion(userQ));
    const retrievalMode = String(
      finalContext._libraryRetrievalMode || libraryRetrievalMode || "",
    );

    // Ask AI chat retrieval policy (library_task === "chat"):
    // Regression (da96c8a): skipped PDF when ANY short excerpt existed → shallow
    // first-pages answers. Correct Ask AI architecture:
    //   FULL extract indexed → retrieve relevant windows from ANY page → AI
    // Do NOT dump the entire PDF into every chat request when full-document
    // multi-window / inventory / clause retrieval already succeeded.
    // Expert Studio tools (notes/summary/quiz/…) keep full-PDF attach for depth.
    const strongAskAiRetrieval =
      libraryTask === "chat" &&
      excerptChars >= 1800 &&
      isStrongIsoFocusExcerpt(String(finalContext.iso_clause_excerpt || "")) &&
      (retrievalMode === "chat_multi_window" ||
        retrievalMode === "documented_information_inventory" ||
        retrievalMode === "clause_window");

    const excerptSufficientForAttachSkip =
      (libraryTask === "starter_questions" && excerptChars >= 1200) ||
      strongAskAiRetrieval;

    const willAttachPdf =
      Boolean(downloadedFile || payload.file) && !excerptSufficientForAttachSkip;
    const pdfAttached = willAttachPdf || Boolean(payload.file);
    attachMode = willAttachPdf
      ? "full_pdf"
      : hasIsoExcerpt
        ? "excerpt_only"
        : downloadedFile || payload.file
          ? "full_pdf"
          : "none";
    const clauseForBrief =
      String(finalContext.clause || finalContext.clauseId || "").trim() ||
      extractClauseKeyFromQuestion(userQ) ||
      "";

    const excerptCap =
      libraryTask === "exam_questions" ||
      libraryTask === "starter_questions" ||
      libraryTask === "quiz" ||
      libraryTask === "flashcards" ||
      libraryTask === "notes" ||
      libraryTask === "summary" ||
      libraryTask === "eli5" ||
      retrievalMode === "ask_ai_question_seed"
        ? 4200
        : inventoryMode
          ? 4800
          : retrievalMode === "chat_multi_window"
            ? willAttachPdf
              ? 4000
              : 4800
            : retrievalMode === "clause_window" && !willAttachPdf
              ? 2800
              : 2400;

    const inventoryInstructions = inventoryMode
      ? [
          `TASK: Answer the user's inventory/list question about ${standardTitle}.`,
          pdfAttached
            ? "The selected ISO standard PDF is attached — use the FULL attached PDF as the authoritative source across ALL clauses/pages (not only the excerpt)."
            : "Use the source material from the selected standard below as the authoritative source.",
          "Focus on documented information / mandatory documents / maintain vs retain exactly as stated in the source.",
          "Prefer a clear structured list or table with clause references when the source supports them.",
          "Do not invent items. Do not pad with generic management-system advice. Do not substitute another ISO family or edition.",
        ].join(" ")
      : "";

    const rawExcerpt = hasIsoExcerpt
      ? String(finalContext.iso_clause_excerpt).slice(0, excerptCap)
      : "";
    // When full PDF is attached, drop weak early-page/TOC excerpts so they cannot
    // overshadow the complete standard — BUT never leave studio tools (notes /
    // summary) with zero text grounding; that caused literary-fiction hallucinations.
    let promptExcerpt =
      rawExcerpt &&
      (!willAttachPdf || isStrongIsoFocusExcerpt(rawExcerpt))
        ? rawExcerpt
        : "";
    if (
      !promptExcerpt &&
      rawExcerpt &&
      (libraryTask === "notes" ||
        libraryTask === "summary" ||
        libraryTask === "eli5" ||
        libraryTask === "flashcards" ||
        libraryTask === "quiz")
    ) {
      promptExcerpt = rawExcerpt;
    }

    const attachNote =
      isoFileAttachFailed || finalContext.iso_file_attached === false
        ? "NOTE: The selected ISO PDF could not be attached for this request. Do not invent clause text; say the available source material is insufficient if you cannot ground the answer."
        : willAttachPdf && promptExcerpt
          ? "NOTE: The selected ISO standard PDF is attached (full document). The excerpt below is only a focus aid — search the FULL attached PDF for requirements on any clause/page. Do not invent clauses."
          : willAttachPdf
            ? "NOTE: The selected ISO standard PDF is attached (full document). Use relevant content from ANY clause/page. Do not invent clauses."
          : attachMode === "excerpt_only"
            ? "NOTE: Use the source material from the selected standard provided above. Do not invent clauses."
            : pdfAttached && !promptExcerpt
              ? "NOTE: The selected ISO standard PDF is attached. Use the attached PDF content for the selected standard/clause across the full document. Only say the source is insufficient if the PDF truly lacks the requested topic."
              : "";

    const brief = [
      LIBRARY_BRIEF_HEADER,
      `SELECTED STANDARD: ${standardTitle}`,
      clauseForBrief ? `CLAUSE FOCUS: ${clauseForBrief}` : "",
      sourcesList ? `Sources to prefer: ${sourcesList}` : "",
      inventoryInstructions || taskInstructions,
      promptExcerpt
        ? willAttachPdf
          ? `Focus excerpt from the selected standard (aid only — full PDF is attached):\n${promptExcerpt}`
          : `Source material from the selected standard (use this to answer — do not claim it is insufficient):\n${promptExcerpt}`
        : "",
      !inventoryMode && finalContext.library_doc_excerpt
        ? `Related reference material:\n${String(finalContext.library_doc_excerpt).slice(0, 1200)}`
        : "",
      attachNote,
      `USER REQUEST: ${userQ}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    payload.messages = brief;

    // Stash task for post-response validation
    finalContext.library_task_resolved = libraryTask;
    finalContext._attachMode = attachMode;

    const debugChunks: LibraryRagChunkDebug[] = Array.isArray(
      finalContext._libraryRagChunks,
    )
      ? finalContext._libraryRagChunks
      : [];
    logLibraryRagDebug({
      standardId: String(finalContext.isoStandardId || ""),
      standardTitle,
      retrievalMode: retrievalMode || attachMode,
      questionType: inventoryMode
        ? "documented_information_inventory"
        : libraryTask,
      chunkCount: debugChunks.length || (promptExcerpt ? 1 : 0),
      totalChars: excerptChars,
      chunksInsertedIntoPrompt: promptExcerpt
        ? debugChunks.length || 1
        : 0,
      promptExcerptChars: promptExcerpt.length,
      attachMode,
      extractedPdfChars: Number(finalContext._libraryExtractedPdfChars || 0) || undefined,
      coverage: finalContext._libraryCoverage as IsoExtractCoverage | undefined,
      chunks: debugChunks.length
        ? debugChunks
        : promptExcerpt
          ? [
              {
                index: 0,
                start: 0,
                end: Math.min(excerptChars, excerptCap),
                score: 0,
                preview: promptExcerpt.slice(0, 160),
              },
            ]
          : [],
    });

    remoteContext = {
      isoStandardId: finalContext.isoStandardId || undefined,
      purpose: "library_standards",
      ...(clauseForBrief ? { clause: clauseForBrief } : {}),
      instruction:
        libraryTask === "exam_questions"
          ? `Generate ${studioQuestionCount} difficult exam-style questions grounded ONLY in ${standardTitle} and the provided source material. Cover different requirement themes across the standard. No open-ended coaching prompts. No invented clauses. Never use internal system terminology.`
          : libraryTask === "quiz"
            ? `Generate ${studioQuestionCount} multiple-choice quiz questions grounded ONLY in ${standardTitle}. Unique questions only. Never use internal system terminology.`
          : libraryTask === "starter_questions"
          ? `Generate difficult exam-style questions grounded ONLY in ${standardTitle} and the provided source material. No open-ended coaching prompts. No invented clauses. Never use internal system terminology.`
          : pdfAttached
            ? inventoryMode
              ? `Answer as an ISO consultant for ${standardTitle}. The full selected ISO PDF is attached — use the entire document (all clauses/pages), not only any focus excerpt. List documented information / maintain vs retain only when supported by the attached standard. Prefer clause references. Do not invent items. Never use internal system terminology.`
              : `Answer as an ISO consultant using the attached selected ISO PDF (full document). Answer the user's specific question using relevant content from ANY clause/page. Focus excerpts are aids only. Do not invent clauses or substitute editions. Only say the source is insufficient if the attached PDF truly lacks the topic. Never use internal system terminology.`
            : hasIsoExcerpt
              ? "Answer as an ISO consultant using the SELECTED STANDARD source material below. Answer the user's specific question. Do not invent clauses or substitute editions. Do not claim the source is insufficient when source material from the selected standard is provided. Never use internal system terminology."
              : "Answer as an ISO consultant using the selected ISO standard and any attached ISO document. Do not invent clauses or substitute editions. If evidence is missing, say the available source material is insufficient. Never use internal system terminology.",
    };
  }

  // 🔥 4. prepare AI payload — always forward DB session to remote /chat for follow-ups
  const finalPayload = {
    ...payload,
    context: remoteContext,
    session_id: session?.id || payload.session_id || undefined,
  };

  // Library: attach full PDF when attachMode is full_pdf (chat/study tools).
  // Starter chips may remain excerpt_only for latency.
  const libraryAttachMode = String(finalContext?._attachMode || "");
  const shouldAttachFullPdf =
    Boolean(downloadedFile) &&
    (finalContext?.purpose !== "library_standards" ||
      libraryAttachMode === "full_pdf" ||
      !libraryAttachMode);

  if (shouldAttachFullPdf && downloadedFile) {
    finalPayload.file = downloadedFile;
    attachMode = "full_pdf";
  } else if (
    finalContext?.purpose === "library_standards" &&
    downloadedFile &&
    libraryAttachMode === "excerpt_only"
  ) {
    attachMode = "excerpt_only";
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
  const tAi = Date.now();
  let aiResponse = await callAI(finalPayload);
  latency.aiMs = Date.now() - tAi;

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

  // Reject literary-fiction / empty studio outputs (notes/summary) and retry once
  // with an explicit grounded brief. Some standards previously returned one-line
  // narrative prose while still showing VERIFIED in the UI.
  if (
    finalContext?.purpose === "library_standards" &&
    typeof aiResponse?.response === "string"
  ) {
    const studioTask =
      finalContext.library_task_resolved ||
      resolveLibraryTask(finalContext, questionText || "");
    if (
      (studioTask === "notes" ||
        studioTask === "summary" ||
        studioTask === "eli5" ||
        studioTask === "flashcards" ||
        studioTask === "quiz" ||
        studioTask === "exam_questions") &&
      isUnusableLibraryStudioResponse(aiResponse.response, studioTask)
    ) {
      console.warn(
        `[Library] unusable ${studioTask} response rejected standard=${finalContext.isoStandard?.title || finalContext.isoStandardId || "n/a"} chars=${String(aiResponse.response).length} preview=${JSON.stringify(String(aiResponse.response).slice(0, 120))}`,
      );
      const retryBrief = [
        String(finalPayload.messages || ""),
        "CRITICAL: Your previous reply was unusable (too short, narrative fiction, or not grounded in the selected ISO standard).",
        "Produce the requested study material now using ONLY the selected ISO standard PDF / source excerpts.",
        "Use clear markdown headings and bullet points. Include concrete requirements language from the source (shall/should/clause) when present.",
        "Do NOT write stories, fiction, metaphors, or literary prose.",
      ]
        .filter(Boolean)
        .join("\n\n");
      try {
        const tRetry = Date.now();
        const retryResponse = await callAI({
          ...finalPayload,
          messages: retryBrief,
        });
        latency.aiMs = (latency.aiMs || 0) + (Date.now() - tRetry);
        if (
          retryResponse &&
          typeof retryResponse.response === "string" &&
          !isUnusableLibraryStudioResponse(
            sanitizeLibraryAssistantText(retryResponse.response),
            studioTask,
          )
        ) {
          aiResponse = {
            ...retryResponse,
            response: sanitizeLibraryAssistantText(retryResponse.response),
          };
          console.log(
            `[Library] ${studioTask} retry accepted standard=${finalContext.isoStandard?.title || finalContext.isoStandardId || "n/a"} chars=${String(aiResponse.response).length}`,
          );
        } else {
          aiResponse = {
            ...(aiResponse || {}),
            response:
              "The available source material could not be turned into reliable study notes for this request. Please try Generate Notes again, or ask a specific clause question about the selected standard.",
            sources: aiResponse?.sources || [],
          };
          console.warn(
            `[Library] ${studioTask} retry still unusable — controlled fallback used`,
          );
        }
      } catch (retryErr) {
        console.error(`[Library] ${studioTask} retry failed`, retryErr);
        aiResponse = {
          ...(aiResponse || {}),
          response:
            "The available source material could not be turned into reliable study notes for this request. Please try again.",
          sources: aiResponse?.sources || [],
        };
      }
    }
  }

  // Validate / normalize exam & starter question lists (drop coaching filler)
  if (
    finalContext?.purpose === "library_standards" &&
    typeof aiResponse?.response === "string"
  ) {
    const taskDone =
      finalContext.library_task_resolved ||
      resolveLibraryTask(finalContext, questionText || "");
    const studioLimit =
      Number(finalContext._studio_question_count) || LIBRARY_STUDIO_QUESTION_COUNT;
    if (taskDone === "starter_questions") {
      const qs = parseGeneratedExamQuestions(
        aiResponse.response,
        LIBRARY_STARTER_QUESTION_COUNT,
      );
      if (qs.length >= 3) {
        aiResponse.response = qs.map((q, i) => `${i + 1}. ${q}`).join("\n");
        aiResponse.suggested_followups = qs;
      }
      console.log(
        `[Library] starter_questions validated count=${qs.length} standard=${finalContext.isoStandard?.title || finalContext.isoStandardId || "n/a"}`,
      );
    } else if (taskDone === "exam_questions") {
      const qs = parseGeneratedExamQuestions(aiResponse.response, studioLimit);
      if (qs.length >= 3) {
        // Keep markdown structure but ensure suggested chips are clean
        aiResponse.suggested_followups = qs.slice(0, Math.min(8, qs.length));
      }
      console.log(
        `[Library] exam_questions validated count=${qs.length} requested=${studioLimit} excludePrior=${finalContext._exclude_questions_count || 0} standard=${finalContext.isoStandard?.title || finalContext.isoStandardId || "n/a"}`,
      );
      if (qs.length > 0 && qs.length < Math.min(10, studioLimit)) {
        console.log(
          `[Library] exam_questions below target (${qs.length}/${studioLimit}) — returning source-supported set without fabricating duplicates`,
        );
      }
    } else if (taskDone === "quiz") {
      const quizCount = countLibraryQuizQuestions(aiResponse.response);
      console.log(
        `[Library] quiz validated count=${quizCount} requested=${studioLimit} excludePrior=${finalContext._exclude_questions_count || 0} standard=${finalContext.isoStandard?.title || finalContext.isoStandardId || "n/a"}`,
      );
      if (quizCount > 0 && quizCount < Math.min(10, studioLimit)) {
        console.log(
          `[Library] quiz below target (${quizCount}/${studioLimit}) — returning source-supported set without fabricating duplicates`,
        );
      }
    } else {
      // Normal Library chat: strip static/generic remote follow-up chips
      const remoteChips = Array.isArray(aiResponse.suggested_followups)
        ? aiResponse.suggested_followups
        : [];
      const cleaned = filterExamStyleQuestions(
        remoteChips.map((q: unknown) => String(q || "")),
        LIBRARY_STARTER_QUESTION_COUNT,
      );
      aiResponse.suggested_followups = cleaned;
    }
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

  // 🔥 6. ONLY logged user → save messages (never persist starter chip generation as a chat)
  const tSave = Date.now();
  if (userId && session && !skipSessionPersistence) {
    const userMessageForStore =
      libraryVisibleLabel ||
      (typeof messages === "string"
        ? messages
        : typeof questionText === "string" && questionText
          ? questionText
          : JSON.stringify(messages ?? ""));

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
  latency.saveMs = Date.now() - tSave;
  latency.totalMs = Date.now() - tReq;

  console.log(
    `[AI LATENCY] purpose=${finalContext?.purpose || "general"} task=${finalContext?.library_task_resolved || earlyLibraryTask || "n/a"} total=${latency.totalMs}ms isoResolve=${latency.isoResolveMs || 0}ms pdfDownload=${latency.pdfDownloadMs || 0}ms pdfCache=${pdfCacheHit ? "hit" : "miss"} grounding=${latency.groundingMs || 0}ms ai=${latency.aiMs || 0}ms save=${latency.saveMs || 0}ms attach=${attachMode} excerptChars=${String(finalContext?.iso_clause_excerpt || "").length} promptChars=${String(payload.messages || "").length}`,
  );

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
      const cached = await getCachedIsoPdfBuffer(iso.fileUrl);
      if (cached) {
        formData.append("file", cached.buffer, {
          filename: cached.originalname || `${iso.title || "standard"}.pdf`,
        });
        attachedFile = true;
      }
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
  let groundingStandardTitle = "";
  let groundingStandardId = "";
  let guidelineTitle = "";
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
    const objective = String(
      (typeof lockedContext === "object" &&
        (lockedContext.objective || lockedContext.objectives)) ||
        "",
    ).trim();
    const queryHints = [
      stepTitle || meta?.title || "",
      meta?.focus || "",
      objective,
      clause,
      criteria,
    ]
      .filter(Boolean)
      .join(" ");

    const groundingWork = Promise.all([
      criteria.length >= 5
        ? getNavigatorGroundingExcerpt({
            specificRequirements: criteria,
            clause: clause || undefined,
            documentTitle: stepTitle || meta?.title,
            queryHints,
            // Audit Lens already pulls ISO + 19011 guideline in parallel —
            // skip extra supporting-doc PDF download on the hot path.
            skipSupporting: true,
          })
        : Promise.resolve({
            excerpt: "",
            standardTitle: undefined as string | undefined,
            standardId: undefined as string | undefined,
          }),
      getAuditGuidelineExcerpt({
        criteria,
        stepTitle: stepTitle || meta?.title,
      }),
    ]);

    const [grounding, guideline] = await groundingWork;
    groundingExcerpt = (grounding.excerpt || "").slice(0, 4000);
    groundingStandardTitle = String(grounding.standardTitle || "").trim();
    groundingStandardId = String(grounding.standardId || "").trim();
    guidelineExcerpt = (guideline.excerpt || "").slice(0, 2500);
    guidelineTitle = String(guideline.title || "").trim();

    console.log(
      `[AuditLens] grounding step=${stepNumber} criteria=${criteria.slice(0, 80)} clause=${clause || "n/a"} standardId=${groundingStandardId || "n/a"} standardTitle=${(groundingStandardTitle || "n/a").slice(0, 100)} isoChars=${groundingExcerpt.length} guidelineChars=${guidelineExcerpt.length} guidelineTitle=${(guidelineTitle || "n/a").slice(0, 80)}`,
    );
  } catch (error: any) {
    console.warn(
      `[AuditLens] grounding failed step=${stepNumber} message=${error?.message || error}`,
    );
  }
  mark("grounding", tGround);

  // Case Study overlaps /audit-lens/step — started AFTER grounding so it can use excerpts
  const casePromise = generateAuditCaseStudyViaChat({
    stepNumber,
    stepTitle: stepTitle || meta.title,
    stage,
    lockedContext,
    groundingExcerpt: groundingExcerpt || undefined,
    guidelineExcerpt: guidelineExcerpt || undefined,
    standardTitle: groundingStandardTitle || undefined,
  }).catch((err: any) => {
    console.warn(
      "[AuditLens] Case Study /chat fill failed:",
      err?.message || err,
    );
    return "";
  });

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
    groundingExcerpt: groundingExcerpt || undefined,
    guidelineExcerpt: guidelineExcerpt || undefined,
    standardTitle: groundingStandardTitle || undefined,
    standardId: groundingStandardId || undefined,
    guidelineTitle: guidelineTitle || undefined,
  });

  const aiPayload: Record<string, unknown> = {
    ...folded,
    // Keep top-level copies for any external service that does read them
    grounding_excerpt: groundingExcerpt || undefined,
    guideline_excerpt: guidelineExcerpt || undefined,
    resolved_iso_standard: groundingStandardTitle || undefined,
    resolved_iso_standard_id: groundingStandardId || undefined,
  };
  Object.keys(aiPayload).forEach((key) => {
    if (aiPayload[key] === undefined || aiPayload[key] === "") {
      delete aiPayload[key];
    }
  });

  console.log(
    `[AuditLens] payload step=${stepNumber} lockedHasIsoExcerpt=${Boolean(
      (folded.locked_context as any)?.iso_library_excerpt,
    )} lockedHasGuideline=${Boolean(
      (folded.locked_context as any)?.audit_guideline_excerpt,
    )} instructionsChars=${generation_instructions.length}`,
  );

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
  groundingExcerpt?: string;
  guidelineExcerpt?: string;
  standardTitle?: string;
}): Promise<string> => {
  const ctx = params.lockedContext || {};
  const org =
    ctx.organization ||
    ctx.organization_name ||
    ctx.client ||
    "the audited organization";
  const criteria =
    params.standardTitle ||
    ctx.criteria ||
    ctx.standard ||
    "the applicable ISO standard";
  const scope = ctx.scope || "the defined audit scope";
  const isoGround = (params.groundingExcerpt || "").trim().slice(0, 1800);
  const guideGround = (params.guidelineExcerpt || "").trim().slice(0, 900);

  const prompt = [
    `Write an educational Demonstrated Case Study for Audit Lens step ${params.stepNumber}: ${params.stepTitle} (${params.stage}).`,
    `Setting only (do not invent real findings): organization=${org}; criteria=${criteria}; scope=${scope}.`,
    isoGround
      ? `Use this ISO library excerpt only as requirement context (do not invent clauses beyond it):\n${isoGround}`
      : "",
    guideGround ? `Optional audit methodology excerpt:\n${guideGround}` : "",
    "Use this exact markdown structure:",
    "## 4. Demonstrated Case Study",
    "**Demonstrated Case Study — Hypothetical Example (Not Actual Audit Evidence)**",
    "### The Situation",
    "### What the Auditor Checks",
    "### Evidence the Auditor Looks For",
    "### How the Requirement Is Applied",
    "### What the Auditor Would Document",
    "Keep it educational and clearly hypothetical. Do not claim real interviews, inspections, or compliance outcomes about the user's organization.",
  ]
    .filter(Boolean)
    .join("\n");

  const formData = new FormData();
  formData.append("messages", prompt);
  formData.append(
    "context",
    JSON.stringify({
      purpose: "audit_lens_case_study",
      step_number: params.stepNumber,
      step_title: params.stepTitle,
      stage: params.stage,
      standard_title: params.standardTitle || undefined,
      has_iso_grounding: Boolean(isoGround),
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

/**
 * Source-grounded IMS Documents & Records for Navigator Step 3.
 * Uses IMS Practical Guide + selected standards only (deep inventory retrieval).
 */
const getNavigatorImsDocuments = async (payload: any = {}) => {
  const specificRequirements = String(
    payload.specific_requirements ||
      payload.standard ||
      payload.ims_label ||
      "",
  ).trim();
  if (!looksLikeNavigatorImsLabel(specificRequirements)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "specific_requirements must be an Integrated Management Systems selection.",
    );
  }
  const tokens = collectImsIntegrationStandardTokens(specificRequirements);
  if (tokens.length < 2) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "IMS selection must list at least two ISO standards.",
    );
  }

  const inventory = await buildImsDocumentedInformationInventory(
    specificRequirements,
  );

  if (inventory.imsGuideAvailable === false) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Integrated Management System Practical Guide was not found in the library. Documents & Records cannot be generated without that source.",
    );
  }

  return {
    standard: `Integrated Management Systems (${tokens.join(", ")})`,
    documents: inventory.documents,
    records: inventory.records,
    ims_inventory_pending: false,
    ims_guide_title: inventory.imsGuideTitle,
    ims_guide_available: inventory.imsGuideAvailable,
    missing_editions: inventory.missingEditions || [],
    grounding_sources: inventory.groundingSources || [],
    excerpt_chars: inventory.excerptChars || 0,
  };
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
    // Documents & Records for IMS are enriched on-demand (navigator/ims-documents).
    const withEditions = applyLatestLibraryEditionsToPayload(
      response.data,
      library,
      { dropUnavailableFamilies: true },
    );
    const ensured = ensureNavigatorImsSuggestions(
      withEditions,
      sourceText,
      library,
    );
    // Mark pending inventory explicitly for any IMS row still needing enrichment.
    if (Array.isArray(ensured?.suggestions)) {
      ensured.suggestions = ensured.suggestions.map((sug: any) => {
        if (!looksLikeNavigatorImsLabel(String(sug?.standard || ""))) return sug;
        if (!imsSuggestionNeedsDocumentInventory(sug)) return sug;
        return { ...sug, ims_inventory_pending: true };
      });
    }
    return ensured;
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

  const topic = String(
    context.topic ||
      context.standardTitle ||
      payload?.topic ||
      "the selected ISO standard",
  );
  const isoStandardId = String(
    context.isoStandardId || payload?.isoStandardId || "",
  ).trim();

  // Prefer grounded Library chat when a standard id is available
  if (isoStandardId && /^[a-fA-F0-9]{24}$/.test(isoStandardId)) {
    try {
      const grounded = await chat("", {
        messages: [
          "Generate exactly 5 difficult exam-style follow-up questions for this ISO standard.",
          "Each question must be direct, technical, and answerable from the standard (purpose, evidence, responsibilities, documented information, implementation).",
          "Do NOT generate open-ended coaching prompts such as: What is your scope?, What do you know about…, Can you explain…, How would you define…, What is ISO…?",
          "Return only a numbered list of 5 questions.",
        ].join(" "),
        context: {
          purpose: "library_standards",
          isoStandardId,
          library_task: "starter_questions",
        },
      });
      const qs = parseGeneratedExamQuestions(
        String(grounded?.response || ""),
        5,
      );
      if (qs.length >= 3) {
        return { success: true, data: { questions: qs }, questions: qs };
      }
    } catch (error: any) {
      console.warn(
        `[Library] grounded followup failed id=${isoStandardId} message=${error?.message || error}`,
      );
    }
  }

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
        'Do NOT use static chips like: "Can you give me a practical example?", "What are the common non-conformances in this area?", "How does this apply to a small organisation?", "What documentation is required?"',
        "Do NOT ask about the learner's own organization.",
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
      const filtered = filterExamStyleQuestions(
        questionsRaw.map((q: any) => String(q || "")),
        5,
      );

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

const warmLibraryIsoPdf = async (isoStandardId: string) => {
  if (!isoStandardId || !isValidObjectId(isoStandardId)) {
    return { warmed: false, reason: "invalid_id" as const };
  }
  const t0 = Date.now();
  const iso = await prisma.iSOStandard.findUnique({
    where: { id: isoStandardId },
    select: { id: true, title: true, fileUrl: true },
  });
  if (!iso?.fileUrl) {
    return { warmed: false, reason: "no_file" as const };
  }
  const cached = await getCachedIsoPdfBuffer(iso.fileUrl);
  if (!cached) {
    return { warmed: false, reason: "download_failed" as const, ms: Date.now() - t0 };
  }
  const { extractCachedIsoPdfText, isoPdfUrlCacheKey } = await import("./isoPdfCache");
  await extractCachedIsoPdfText(isoPdfUrlCacheKey(iso.fileUrl), cached.buffer);
  const ms = Date.now() - t0;
  console.log(
    `[AI LATENCY] warmPdf id=${iso.id} cacheHit=${cached.cacheHit} ms=${ms} title=${String(iso.title || "").slice(0, 60)}`,
  );
  return {
    warmed: true,
    cacheHit: cached.cacheHit,
    ms,
    standardId: iso.id,
  };
};

export const AIAssistantService = {
  generateISO,
  simpleChat,
  chat,
  generateFlashcards,
  warmLibraryIsoPdf,
  getChatSessions,
  getChatHistory,
  getSessionsByISO,
  getAuditContext,
  getAuditStep,
  analyzeBenchmarkFile,
  analyzeBenchmarkText,
  generateContext,
  getISOSuggestions,
  getNavigatorImsDocuments,
  getBenchmarkAISuggestions,
  generateFollowup,
};
