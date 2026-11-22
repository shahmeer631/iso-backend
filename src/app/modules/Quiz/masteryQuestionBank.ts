import { createHash, randomUUID } from "crypto";
import prisma from "../../../shared/prisma";
import { TrustedExamQuestion } from "../Gamification/xp.integrity";

export const hashQuestionStem = (stem: string): string =>
  createHash("sha256")
    .update(String(stem || "").trim().toLowerCase().replace(/\s+/g, " "))
    .digest("hex");

export const loadPriorQuestionHashes = async (params: {
  userId?: string | null;
  guestId?: string | null;
}): Promise<Set<string>> => {
  const or: Array<{ userId?: string; guestId?: string }> = [];
  if (params.userId) or.push({ userId: params.userId });
  if (params.guestId) or.push({ guestId: params.guestId });
  if (!or.length) return new Set();

  try {
    const rows = await (prisma as any).masteryQuestionHistory.findMany({
      where: { OR: or },
      select: { questionHash: true },
      take: 500,
      orderBy: { createdAt: "desc" },
    });
    return new Set(rows.map((r: { questionHash: string }) => r.questionHash));
  } catch (err: any) {
    // Model may not be migrated yet — fail soft
    console.warn(
      "[MasteryQuestionBank] history load skipped:",
      err?.message || err,
    );
    return new Set();
  }
};

export const recordQuestionHistory = async (params: {
  userId?: string | null;
  guestId?: string | null;
  questions: string[];
  industry?: string;
}) => {
  if (!params.userId && !params.guestId) return;
  const rows = params.questions
    .map((q) => ({
      userId: params.userId || null,
      guestId: params.guestId || null,
      questionHash: hashQuestionStem(q),
      industry: params.industry || null,
    }))
    .filter((r) => r.questionHash);

  if (!rows.length) return;

  try {
    // createMany may not de-dupe on Mongo; ignore unique races
    await (prisma as any).masteryQuestionHistory.createMany({ data: rows });
  } catch (err: any) {
    console.warn(
      "[MasteryQuestionBank] history createMany failed:",
      err?.message || err,
    );
  }
};

type BankQuestionPayload = {
  id: string;
  question: string;
  options: Array<{ label: string; text: string }>;
  answer: string;
  explanation?: string;
  standard?: string;
  version?: string;
  clause?: string;
  subclause?: string;
  exam_level?: string;
  pillar?: string;
  difficulty?: string;
  qualityScore?: number;
};

export const stashQuestionBank = async (params: {
  userId?: string | null;
  guestId?: string | null;
  industry: string;
  management_level: string;
  department: string;
  questions: BankQuestionPayload[];
}) => {
  if (!params.userId && !params.guestId) return;
  if (!params.questions.length) return;

  try {
    await (prisma as any).masteryQuestionBank.createMany({
      data: params.questions.map((q) => ({
        userId: params.userId || null,
        guestId: params.guestId || null,
        industry: params.industry,
        managementLevel: params.management_level,
        department: params.department,
        questionHash: hashQuestionStem(q.question),
        questionPayload: q,
      })),
    });
  } catch (err: any) {
    console.warn(
      "[MasteryQuestionBank] bank stash failed:",
      err?.message || err,
    );
  }
};

const toClientQuestion = (q: BankQuestionPayload) => {
  const optionsRecord = Object.fromEntries(
    (q.options || []).map((o) => [o.label, o.text]),
  );
  return {
    id: q.id || randomUUID(),
    question: q.question,
    options: optionsRecord,
    correct_answer: q.answer,
    explanation: q.explanation || "",
    standard: q.standard || "",
    version: q.version || "",
    clause: q.clause || "",
    subclause: q.subclause || "",
    exam_level: q.exam_level || "",
    pillar: q.pillar || "",
    difficulty: q.difficulty || "expert",
    qualityScore: q.qualityScore,
  };
};

/**
 * Drain unused bank items for this RACI profile when enough exist.
 * Returns a generateQuiz-compatible payload or null to fall through to live AI.
 */
export const tryServeFromQuestionBank = async (params: {
  userId?: string | null;
  guestId?: string | null;
  industry: string;
  management_level: string;
  department: string;
  count: number;
  priorHashes: Set<string>;
}): Promise<null | {
  examSessionId: string | null;
  questions: ReturnType<typeof toClientQuestion>[];
  metadata: Record<string, unknown>;
  validation: Record<string, unknown>;
  served_from: "question_bank";
}> => {
  if (!params.userId && !params.guestId) return null;

  const ownerOr: Array<{ userId?: string; guestId?: string }> = [];
  if (params.userId) ownerOr.push({ userId: params.userId });
  if (params.guestId) ownerOr.push({ guestId: params.guestId });

  try {
    const candidates = await (prisma as any).masteryQuestionBank.findMany({
      where: {
        OR: ownerOr,
        industry: params.industry,
        managementLevel: params.management_level,
        department: params.department,
        consumedAt: null,
      },
      orderBy: { createdAt: "asc" },
      take: Math.max(params.count * 2, 40),
    });

    const fresh = candidates.filter(
      (row: any) => !params.priorHashes.has(row.questionHash),
    );
    if (fresh.length < Math.min(params.count, 10)) {
      return null;
    }

    const picked = fresh.slice(0, params.count);
    const now = new Date();
    await (prisma as any).masteryQuestionBank.updateMany({
      where: { id: { in: picked.map((p: any) => p.id) } },
      data: { consumedAt: now },
    });

    const payloads: BankQuestionPayload[] = picked.map((p: any) => {
      const q = p.questionPayload || {};
      return {
        id: q.id || randomUUID(),
        question: q.question,
        options: q.options || [],
        answer: q.answer || q.correct_answer,
        explanation: q.explanation,
        standard: q.standard,
        version: q.version,
        clause: q.clause,
        subclause: q.subclause,
        exam_level: q.exam_level || params.management_level,
        pillar: q.pillar,
        difficulty: q.difficulty || "expert",
        qualityScore: q.qualityScore,
      };
    });

    const trustedQuestions: TrustedExamQuestion[] = payloads.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options,
      answer: q.answer,
      explanation: q.explanation,
      standard: q.standard,
      version: q.version,
      clause: q.clause,
      subclause: q.subclause,
      exam_level: q.exam_level || params.management_level,
      pillar: q.pillar,
      difficulty: q.difficulty || "expert",
      qualityScore: q.qualityScore,
    }));

    const session = await prisma.masteryExamSession.create({
      data: {
        userId: params.userId || null,
        guestId: params.guestId || null,
        questions: trustedQuestions as object[],
        metadata: {
          industry: params.industry,
          management_level: params.management_level,
          department: params.department,
          served_from: "question_bank",
        } as object,
      },
    });

    await recordQuestionHistory({
      userId: params.userId,
      guestId: params.guestId,
      questions: payloads.map((q) => q.question),
      industry: params.industry,
    });

    const clientQuestions = payloads.map(toClientQuestion);
    const validation = {
      accepted: payloads.length,
      published: payloads.length,
      rejected: 0,
      requested: params.count,
      served_from: "question_bank",
    };

    return {
      examSessionId: session.id,
      questions: clientQuestions,
      metadata: {
        industry: params.industry,
        management_level: params.management_level,
        department: params.department,
        served_from: "question_bank",
        validation,
      },
      validation,
      served_from: "question_bank",
    };
  } catch (err: any) {
    console.warn(
      "[MasteryQuestionBank] bank serve skipped:",
      err?.message || err,
    );
    return null;
  }
};
