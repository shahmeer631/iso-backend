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
  findMatchingISOStandard,
  INSTRUCTIONS_GROUNDING_CAP,
} from "./navigatorGenerate.grounding";
import { applyLatestLibraryEditionsToPayload } from "./isoStandardVersion";
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
  normalizeAuditContextResponse,
  normalizeAuditStepResponse,
} from "./auditLens.normalize";
import { getAuditGuidelineExcerpt } from "./auditLens.grounding";

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
  const libraryMatch = await findMatchingISOStandard(specific_requirements_raw);
  const specific_requirements = libraryMatch?.title || specific_requirements_raw;
  if (libraryMatch && libraryMatch.title !== specific_requirements_raw) {
    console.log(
      `[Navigator] remapped selected standard "${specific_requirements_raw}" → "${libraryMatch.title}" (${libraryMatch.id})`,
    );
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

  const isoStandardId = finalContext?.isoStandardId;

  // 🔥 2. ONLY logged user → session logic
  if (userId) {
    // find existing session
    if (session_id && isValidObjectId(session_id)) {
      session = await prisma.chatSession.findUnique({
        where: { id: session_id },
      });
    }

    // create new session
    if (!session && !session_id) {
      session = await prisma.chatSession.create({
        data: {
          user: {
            connect: { id: userId }, // ✅ FIXED
          },
          title:
            typeof messages === "string" ? generateTitle(messages) : "New Chat",
          isoStandardId: isoStandardId || null,
        },
      });
    }

    // invalid session
    if (!session) {
      throw new Error("Invalid or expired session");
    }
  }

  // 🔥 3. inject ISO data
  let downloadedFile = null;

  if (isoStandardId && isValidObjectId(isoStandardId)) {
    const iso = await prisma.iSOStandard.findUnique({
      where: { id: isoStandardId },
    });

    if (iso) {
      finalContext.isoStandard = {
        title: iso.title,
      };

      finalContext.instruction =
        "Answer based on the provided ISO document content. Be specific and avoid generic answers.";

      // 🔥 Download file from DB if not provided by client
      if (!payload.file && iso.fileUrl) {
        try {
          const fileRes = await axios.get(iso.fileUrl, {
            responseType: "arraybuffer",
          });
          const fileName = iso.fileUrl.split('/').pop() || "document.pdf";

          downloadedFile = {
            buffer: fileRes.data,
            originalname: fileName,
          };
        } catch (error) {
          console.error("Failed to download ISO file:", error);
        }
      }
    }
  }

  // 🔥 4. prepare AI payload
  const finalPayload = {
    ...payload,
    context: finalContext,
  };

  if (downloadedFile) {
    finalPayload.file = downloadedFile;
  }

  // 🔥 5. call AI
  const aiResponse = await callAI(finalPayload);

  // 🔥 6. ONLY logged user → save messages
  if (userId && session) {
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        message:
          typeof messages === "string" ? messages : JSON.stringify(messages),
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

  // 🔥 parse context
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
  let iso = null;

  // 🔥 fetch ISO standard info if exists
  if (isoStandardId && isValidObjectId(isoStandardId)) {
    iso = await prisma.iSOStandard.findUnique({
      where: { id: isoStandardId },
    });
  }

  let session = null;

  // 🔥 ONLY logged user → session logic
  if (userId) {
    // find existing session
    if (session_id && isValidObjectId(session_id)) {
      session = await prisma.chatSession.findUnique({
        where: { id: session_id },
      });
    }

    // create new session if not found
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

    // invalid session
    if (!session) {
      throw new Error("Invalid or expired session");
    }
  }

  // 🔥 form data
  const formData = new FormData();

  formData.append("context", JSON.stringify(finalContext));
  formData.append("num_cards", payload.num_cards || 8);
  formData.append("difficulty", payload.difficulty || "intermediate");

  // 🔥 file handling (uploaded file prioritized, fallback to downloading ISO)
  if (file) {
    formData.append("file", file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
  } else if (iso?.fileUrl) {
    const fileRes = await axios.get(iso.fileUrl, {
      responseType: "arraybuffer",
    });

    formData.append("file", Buffer.from(fileRes.data), {
      filename: `${iso.title}.pdf`,
    });
  }

  // 🔥 AI call
  const response = await axios.post(
    `${process.env.AI_BASE_URL}/quiz/flashcards`,
    formData,
    {
      headers: formData.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    },
  );

  // 🔥 save history
  if (userId && session) {
    // Save User Request Prompt
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        message: `Generate ${payload.num_cards || 8} ${payload.difficulty || "intermediate"} flashcards.`,
      },
    });

    // Save Assistant Response
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        message: JSON.stringify(response.data),
      },
    });

    // Update Session
    await prisma.chatSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });
  }

  return {
    ...response.data,
    session_id: session?.id || null,
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

  const response = await axios.post(
    `${process.env.AI_BASE_URL}/chat`,
    formData,
    {
      headers: formData.getHeaders(),
      maxBodyLength: Infinity,
    },
  );

  return response.data;
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

// 🔥 AUDIT CONTEXT — remap criteria editions to latest ACTIVE Standards Library
const getAuditContext = async (payload: any = {}) => {
  try {
    const response = await axios.post(
      `${process.env.AI_BASE_URL}/audit-lens/context`,
      payload,
      { timeout: 60000 },
    );
    const normalized = normalizeAuditContextResponse(response.data);
    try {
      const library = await prisma.iSOStandard.findMany({
        where: { status: "ACTIVE" },
        select: { title: true },
        take: 200,
      });
      return applyLatestLibraryEditionsToPayload(normalized, library);
    } catch {
      return normalized;
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

  const meta = AUDIT_STEP_META[stepNumber];
  const stepTitle = String(payload.step_title || payload.stepTitle || meta?.title || "").trim();
  const stage = String(payload.stage || meta?.stage || "Plan").trim();
  let lockedContext = payload.locked_context ?? payload.lockedContext ?? {};

  // Align locked criteria/standard labels with latest ACTIVE library edition
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

  // Bounded library grounding — run ISO + guideline retrieval in parallel
  let groundingExcerpt = "";
  let guidelineExcerpt = "";
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

    const [grounding, guideline] = await Promise.all([
      criteria.length >= 5
        ? getNavigatorGroundingExcerpt({
            specificRequirements: criteria,
            clause: clause || undefined,
          })
        : Promise.resolve({ excerpt: "" }),
      getAuditGuidelineExcerpt({
        criteria,
        stepTitle: stepTitle || meta?.title,
      }),
    ]);

    groundingExcerpt = (grounding.excerpt || "").slice(0, 4000);
    guidelineExcerpt = (guideline.excerpt || "").slice(0, 2500);
  } catch {
    // never block step generation on grounding failure
  }

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
      throw mapAiProxyError(error, "Audit step generation");
    }
  };

  let raw = await callStep(aiPayload);
  let normalized = normalizeAuditStepResponse(raw, {
    stepNumber,
    stepTitle: stepTitle || meta.title,
    stage,
  });

  if (!isValidAuditGuidance(normalized.guidance)) {
    raw = await callStep({
      ...aiPayload,
      retry: true,
      generation_instructions: `${generation_instructions}\n\nIMPORTANT: Previous response was empty or invalid. Return non-empty markdown guidance with the required Audit Step / Auditor Guidance / Audit Paper / Template / Case Study (Hypothetical) sections. Do NOT simulate conducting the audit or invent findings.`,
    });
    normalized = normalizeAuditStepResponse(raw, {
      stepNumber,
      stepTitle: stepTitle || meta.title,
      stage,
    });
  }

  if (!isValidAuditGuidance(normalized.guidance)) {
    throw new ApiError(
      httpStatus.BAD_GATEWAY,
      "Audit Lens returned empty or invalid step guidance. Please try again.",
    );
  }

  return normalized;
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
    return applyLatestLibraryEditionsToPayload(response.data, library);
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
  const response = await axios.post(
    `${process.env.AI_BASE_URL}/quiz/followup`,
    payload,
  );

  return response.data;
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
