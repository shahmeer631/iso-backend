import prisma from "../../../shared/prisma";
import ApiError from "../../../errors/ApiErrors";
import httpStatus from "http-status";
import { userHasFeatureAccess } from "../../../helpars/effectiveAccess";
import { extractPdfTextFromBuffer } from "../../../helpars/pdf-parser";
import { parseIsoEdition } from "./isoStandardVersion";

/** Prefer lesson text; keep prompt focused and cheap. */
const LESSON_CONTENT_CAP = 3200;
/** Optional Knowledge Library supporting excerpt. */
const SUPPORTING_DOC_CAP = 1200;
/** Cap when embedding excerpts into context. */
const COURSE_GROUNDING_CAP = 4500;
/** Clause window from locked ISO PDF (reused buffer — no second download). */
const ISO_CLAUSE_CAP = 2200;

export const LEARNING_INSTRUCTION = [
  "You are the ISO Brain Course / Learning assistant.",
  "Primary context is the current course and lesson. Connected ISO standards and library documents are supporting sources only.",
  "Structure answers for learning when helpful: ### Answer, ### Why it matters, ### Example (clearly labeled as an example — never as the learner's real organization), ### Related requirement (only if present in retrieved sources), ### From your course.",
  "Ground every factual claim in the provided course/lesson material, attached ISO document, or retrieved library excerpts.",
  "If the provided material is insufficient, say clearly: I couldn't find enough information in the current course material or connected knowledge sources to answer that confidently.",
  "Do not invent ISO clauses, editions, certification outcomes, company policies, procedures, records, or organizational facts.",
  "Do not claim the learner's organization is compliant or non-compliant. Use placeholders like [Organization to define] when organization-specific detail is needed.",
  "Use only the ISO standard/version provided in context. Never silently substitute another edition or year.",
  "Cite only sources that appear in the learning context (course/lesson, locked ISO title, supporting library doc). Do not invent page numbers or clause numbers.",
].join(" ");

/** Compact instruction for remote /chat (avoids remote 400 on oversized payloads). */
export const LEARNING_BRIEF_HEADER = [
  "You are the ISO Brain Course Learning assistant.",
  "Knowledge priority: (1) current lesson content (2) course materials (3) locked ISO edition (4) relevant clauses from that edition (5) supporting library docs. Ignore unrelated sources.",
  "Prefer structure: Answer | Why it matters | Example (labeled example only — never invent the learner's org) | Related requirement (only if in sources) | From your course.",
  "When asked, you may create study/review questions grounded only in retrieved material.",
  "Ground on learning context + attached locked ISO only. Never invent clauses/editions/org facts.",
  "If unsupported, say you couldn't find enough information in the course material or connected knowledge sources.",
  "Never substitute another ISO edition/year. Never claim the organization is compliant/non-compliant.",
].join(" ");

function isValidObjectId(id: string) {
  return /^[a-fA-F0-9]{24}$/.test(id);
}

function truncate(text: string, max: number): string {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > max ? `${cleaned.slice(0, max).trim()}…` : cleaned;
}

/**
 * Relevance window over lesson content — prefer spans matching the question tokens.
 */
export function selectRelevantLessonExcerpt(
  content: string,
  question: string,
  cap = LESSON_CONTENT_CAP,
): string {
  const cleaned = (content || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= cap) return cleaned;

  const tokens = (question || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3)
    .slice(0, 8);

  if (!tokens.length) return truncate(cleaned, cap);

  const step = Math.max(250, Math.floor(cap / 3));
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < cleaned.length; i += step) {
    const window = cleaned.slice(i, i + cap).toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (window.includes(t)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return truncate(cleaned.slice(bestIdx, bestIdx + cap), cap);
}

export function extractClauseKeyFromQuestion(question: string): string | null {
  const m = (question || "").match(
    /\b(?:clause|cl\.?|section)\s*(\d+(?:\.\d+){0,4})\b/i,
  );
  if (m?.[1]) return m[1];
  const bare = (question || "").match(/\b(\d+\.\d+(?:\.\d+){0,3})\b/);
  return bare?.[1] || null;
}

/**
 * Clause-aware excerpt from already-downloaded ISO PDF buffer (no extra download).
 */
export async function excerptLockedIsoFromBuffer(
  buffer: Buffer | Uint8Array,
  question: string,
): Promise<string> {
  try {
    const raw = await extractPdfTextFromBuffer(buffer);
    const text = (raw || "").replace(/\s+/g, " ").trim();
    if (!text) return "";

    const clauseKey = extractClauseKeyFromQuestion(question);
    if (clauseKey) {
      const re = new RegExp(
        `(?:clause\\s*)?${clauseKey.replace(/\./g, "\\.")}\\b`,
        "i",
      );
      const idx = text.search(re);
      if (idx >= 0) {
        const start = Math.max(0, idx - 350);
        return text.slice(start, start + ISO_CLAUSE_CAP).trim();
      }
    }

    // Keyword window when no clause number — keep short to avoid noise.
    const tokens = (question || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 4)
      .slice(0, 5);
    if (tokens.length) {
      let bestIdx = 0;
      let bestScore = 0;
      const step = 800;
      for (let i = 0; i < Math.min(text.length, 60000); i += step) {
        const window = text.slice(i, i + ISO_CLAUSE_CAP).toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (window.includes(t)) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestScore >= 2) {
        return text.slice(bestIdx, bestIdx + ISO_CLAUSE_CAP).trim();
      }
    }

    return "";
  } catch {
    return "";
  }
}

/**
 * Resolve an ISO standard for a course without inventing editions.
 * Prefer explicit isoStandardId; otherwise title/bundle match only (no "latest" fallback).
 */
async function resolveCourseIsoStandardId(
  courseId: string,
  courseTitle: string,
  categoryId: string | null | undefined,
  explicitIsoId?: string | null,
): Promise<string | null> {
  if (explicitIsoId && isValidObjectId(explicitIsoId)) {
    const iso = await prisma.iSOStandard.findFirst({
      where: { id: explicitIsoId, status: "ACTIVE" },
      select: { id: true },
    });
    return iso?.id || null;
  }

  if (!categoryId) return null;

  const categoryStandards = await prisma.iSOStandard.findMany({
    where: { categoryId, status: "ACTIVE" },
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
  });

  if (!categoryStandards.length) return null;
  if (categoryStandards.length === 1) return categoryStandards[0].id;

  try {
    const bundleWithCourse = await prisma.bundleItem.findFirst({
      where: { itemId: courseId, itemType: "COURSE" },
      include: { bundle: { include: { bundleItems: true } } },
    });
    const standardInBundle = bundleWithCourse?.bundle?.bundleItems?.find(
      (item) => item.itemType === "ISO_STANDARD",
    );
    if (standardInBundle) {
      const match = categoryStandards.find((s) => s.id === standardInBundle.itemId);
      if (match) return match.id;
    }
  } catch {
    // Bundle lookup is best-effort; never block Course AI.
  }

  const title = (courseTitle || "").toLowerCase();
  const courseEdition = parseIsoEdition(courseTitle || "");

  // Exact family + year from course title (e.g. ISO 9001:2026) — never "latest".
  if (courseEdition?.familyKey && courseEdition.year != null) {
    const exact = categoryStandards.find((standard) => {
      const parsed = parseIsoEdition(standard.title);
      return (
        parsed?.familyKey === courseEdition.familyKey &&
        parsed?.year === courseEdition.year
      );
    });
    if (exact) return exact.id;
  }

  const byTitle = categoryStandards.find((standard) =>
    title.includes(standard.title.toLowerCase()),
  );
  // Intentionally no "pick latest" fallback — wrong edition is worse than no ISO file.
  return byTitle?.id || null;
}

async function assertCourseAccess(userId: string | undefined, courseId: string) {
  if (!userId) {
    throw new ApiError(
      httpStatus.UNAUTHORIZED,
      "Authentication required to use Course AI with course content.",
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (user?.role === "SUPER_ADMIN") return;

  // Respect existing subscription ∪ group effective access (COURSES).
  const canUseCourses = await userHasFeatureAccess(userId, "COURSES");
  if (!canUseCourses) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "Upgrade your plan to access Course AI.",
    );
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: { userId, courseId },
    select: { id: true },
  });

  if (!enrollment) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "You must be enrolled in this course to use Course AI.",
    );
  }
}

/**
 * Optional Knowledge Library excerpt in the same category as the course.
 * Keyword-scored; returns empty when relevance is weak. Failures never block chat.
 */
async function getCourseSupportingDocExcerpt(params: {
  categoryId?: string | null;
  question?: string;
  courseTitle?: string;
  isoTitle?: string;
}): Promise<{ excerpt: string; title?: string; documentId?: string }> {
  try {
    if (!params.categoryId) return { excerpt: "" };

    const docs = await prisma.document.findMany({
      where: { categoryId: params.categoryId, status: "ACTIVE" },
      select: {
        id: true,
        title: true,
        description: true,
        fileUrl: true,
        tags: true,
      },
      take: 25,
    });

    if (!docs.length) return { excerpt: "" };

    const q = (params.question || "").toLowerCase();
    const courseKey = (params.courseTitle || "").toLowerCase();
    const isoKey = (params.isoTitle || "").toLowerCase();
    const tokens = q
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3)
      .slice(0, 8);

    let best = docs[0];
    let bestScore = 0;
    for (const doc of docs) {
      const hay = `${doc.title} ${doc.description || ""} ${doc.tags || ""}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (hay.includes(token)) score += 2;
      }
      if (isoKey && hay.includes(isoKey.slice(0, 18))) score += 3;
      if (courseKey && hay.includes(courseKey.slice(0, 18))) score += 2;
      if (score > bestScore) {
        bestScore = score;
        best = doc;
      }
    }

    if (bestScore < 4) return { excerpt: "" };

    // Prefer metadata over PDF parse for Course AI latency (ISO PDF is already attached separately).
    const fallback = (best.description || best.title || "").trim();
    return {
      excerpt: truncate(fallback, SUPPORTING_DOC_CAP),
      title: best.title,
      documentId: best.id,
    };
  } catch (error) {
    console.error("Course supporting doc grounding failed", error);
    return { excerpt: "" };
  }
}

export type CourseLearningEnrichment = {
  context: Record<string, unknown>;
};

/**
 * Enrich chat context for Courses / Learning AI.
 * Reuses existing ISO file attachment via isoStandardId (set here when resolvable).
 * Does not create a second AI engine.
 */
export async function enrichCourseLearningContext(params: {
  userId?: string;
  context: Record<string, any>;
  question?: string;
}): Promise<CourseLearningEnrichment> {
  const ctx = { ...(params.context || {}) };
  const courseId =
    typeof ctx.courseId === "string" && isValidObjectId(ctx.courseId)
      ? ctx.courseId
      : null;
  const lessonId =
    typeof ctx.lessonId === "string" && isValidObjectId(ctx.lessonId)
      ? ctx.lessonId
      : null;
  const purpose = typeof ctx.purpose === "string" ? ctx.purpose : "";

  const isCourseLearning =
    purpose === "course_learning" ||
    purpose === "course_ai" ||
    Boolean(courseId) ||
    Boolean(lessonId);

  if (!isCourseLearning) {
    return { context: ctx };
  }

  if (courseId) {
    await assertCourseAccess(params.userId, courseId);
  }

  let course: {
    id: string;
    title: string;
    description: string | null;
    categoryId: string;
  } | null = null;
  let lesson: {
    id: string;
    title: string | null;
    content: string | null;
    order: number;
    lessonDocuments: { id: string; title: string; type: string; fileUrl: string }[];
    quizTopics: string[];
  } | null = null;

  if (courseId) {
    course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        description: true,
        categoryId: true,
      },
    });
  }

  if (lessonId) {
    const lessonRow = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        title: true,
        content: true,
        order: true,
        courseId: true,
        lessonDocuments: {
          select: { id: true, title: true, type: true, fileUrl: true },
        },
        quizzes: {
          select: {
            questions: {
              select: { question: true },
              take: 8,
            },
          },
          take: 2,
        },
      },
    });

    if (lessonRow) {
      if (courseId && lessonRow.courseId !== courseId) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          "Lesson does not belong to the specified course.",
        );
      }

      const quizTopics = (lessonRow.quizzes || [])
        .flatMap((q) => q.questions || [])
        .map((q) => (q.question || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 8);

      lesson = {
        id: lessonRow.id,
        title: lessonRow.title,
        content: lessonRow.content,
        order: lessonRow.order,
        lessonDocuments: lessonRow.lessonDocuments,
        quizTopics,
      };

      if (!course) {
        await assertCourseAccess(params.userId, lessonRow.courseId);
        course = await prisma.course.findUnique({
          where: { id: lessonRow.courseId },
          select: {
            id: true,
            title: true,
            description: true,
            categoryId: true,
          },
        });
      }
    }
  }

  if (!course && !lesson) {
    ctx.purpose = "course_learning";
    ctx.instruction = LEARNING_INSTRUCTION;
    ctx.course_grounding_note =
      "No course or lesson context could be loaded. Answer only from any attached ISO/library sources; otherwise say information is unavailable.";
    ctx.available_sources = [];
    return { context: ctx };
  }

  const explicitIsoId =
    typeof ctx.isoStandardId === "string" ? ctx.isoStandardId : null;
  const resolvedIsoId = course
    ? await resolveCourseIsoStandardId(
        course.id,
        course.title,
        course.categoryId,
        explicitIsoId,
      )
    : explicitIsoId && isValidObjectId(explicitIsoId)
      ? explicitIsoId
      : null;

  let isoTitle: string | undefined;
  if (resolvedIsoId) {
    ctx.isoStandardId = resolvedIsoId;
    const iso = await prisma.iSOStandard.findUnique({
      where: { id: resolvedIsoId },
      select: { title: true },
    });
    isoTitle = iso?.title;
  }

  const lessonContent = lesson?.content
    ? selectRelevantLessonExcerpt(
        lesson.content,
        params.question || "",
        LESSON_CONTENT_CAP,
      )
    : "";

  const materials =
    lesson?.lessonDocuments?.map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
    })) || [];

  const supporting = await getCourseSupportingDocExcerpt({
    categoryId: course?.categoryId,
    question: params.question,
    courseTitle: course?.title,
    isoTitle,
  });

  const groundingParts: string[] = [];
  const availableSources: string[] = [];

  if (course) {
    groundingParts.push(
      `COURSE: ${course.title}${course.description ? ` — ${truncate(course.description, 400)}` : ""}`,
    );
    availableSources.push(`Course: ${course.title}`);
  }
  if (lesson) {
    groundingParts.push(
      `CURRENT LESSON (order ${lesson.order}): ${lesson.title || "Untitled"}`,
    );
    availableSources.push(`Lesson: ${lesson.title || "Untitled"}`);
    if (lessonContent) {
      groundingParts.push(`LESSON CONTENT:\n${lessonContent}`);
    } else {
      groundingParts.push(
        "LESSON CONTENT: (not provided in database — rely on ISO/library sources and say so if insufficient)",
      );
    }
    if (lesson.quizTopics?.length) {
      groundingParts.push(
        `LESSON KNOWLEDGE-CHECK TOPICS (from quiz; treat as learning objectives signals):\n- ${lesson.quizTopics.map((t) => truncate(t, 180)).join("\n- ")}`,
      );
    }
  }
  if (materials.length) {
    groundingParts.push(
      `LESSON MATERIALS: ${materials.map((m) => m.title).join("; ")}`,
    );
    availableSources.push(
      ...materials.map((m) => `Lesson material: ${m.title}`),
    );
  }
  if (isoTitle) {
    groundingParts.push(
      `LINKED ISO STANDARD (authoritative edition for this course): ${isoTitle}`,
    );
    availableSources.push(`ISO: ${isoTitle}`);
  }
  if (supporting.excerpt) {
    groundingParts.push(
      `SUPPORTING LIBRARY DOC (${supporting.title || "document"}):\n${supporting.excerpt}`,
    );
    ctx.supportingDocumentId = supporting.documentId;
    ctx.supportingDocumentTitle = supporting.title;
    availableSources.push(
      `Library document: ${supporting.title || "document"}`,
    );
  }

  ctx.purpose = "course_learning";
  ctx.instruction = LEARNING_INSTRUCTION;
  ctx.available_sources = availableSources;
  ctx.course = course
    ? {
        id: course.id,
        title: course.title,
        description: course.description
          ? truncate(course.description, 500)
          : null,
      }
    : undefined;
  ctx.lesson = lesson
    ? {
        id: lesson.id,
        title: lesson.title,
        order: lesson.order,
        materials,
      }
    : undefined;
  ctx.course_grounding = truncate(
    groundingParts.join("\n\n"),
    COURSE_GROUNDING_CAP,
  );

  return { context: ctx };
}
