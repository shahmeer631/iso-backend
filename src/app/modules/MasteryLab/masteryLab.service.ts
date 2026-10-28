import { randomUUID } from "crypto";
import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import axios from "axios";
import httpStatus from "http-status";
import { CertificateService } from "../Certificate/certificate.service";
import {
  TrustedExamQuestion,
  scoreAgainstTrustedExam,
} from "../Gamification/xp.integrity";
import {
  assertExamSessionOwnership,
  buildClaimWhere,
  unconsumedWhere,
} from "./masteryExam.claim";
import { isPrismaUniqueConflict } from "../Activity/activity.accounting";

const MASTERY_PASS_SCORE = Number(process.env.MASTERY_PASS_SCORE ?? 70);
const MASTERY_CERT_COURSE_TITLE = "ISO Mastery Lab – Certificate of Competency";
const MASTERY_CERT_TEMPLATE_NAME = "Mastery Lab CPD Certificate";

const ensureMasteryCertificateAssets = async () => {
  const envCourseId = process.env.MASTERY_LAB_CERT_COURSE_ID;
  const envTemplateId = process.env.MASTERY_LAB_CERT_TEMPLATE_ID;

  if (envCourseId && envTemplateId) {
    return { courseId: envCourseId, templateId: envTemplateId };
  }

  let template =
    (await prisma.certificateTemplate.findFirst({
      where: { name: MASTERY_CERT_TEMPLATE_NAME },
    })) ||
    (await prisma.certificateTemplate.findFirst({
      where: { name: { contains: "Mastery" } },
    })) ||
    null;

  if (!template) {
    template = await prisma.certificateTemplate.create({
      data: {
        name: MASTERY_CERT_TEMPLATE_NAME,
        autoIssue: true,
        isActive: true,
      },
    });
  }

  let course =
    (await prisma.course.findFirst({
      where: { title: MASTERY_CERT_COURSE_TITLE },
    })) ||
    (await prisma.course.findFirst({
      where: { slug: "iso-mastery-lab-certificate-of-competency" },
    })) ||
    null;

  if (!course) {
    const anyCategory = await prisma.category.findFirst({
      select: { id: true },
    });

    if (!anyCategory) {
      throw new Error("No category available to attach Mastery Lab certificate course");
    }

    course = await prisma.course.create({
      data: {
        title: MASTERY_CERT_COURSE_TITLE,
        slug: "iso-mastery-lab-certificate-of-competency",
        instructor: "ISOBrain Mastery Lab",
        description:
          "Verifiable CPD Certificate of Competency issued on successful Mastery Lab assessment completion.",
        categoryId: anyCategory.id,
        certificateTemplateId: template.id,
        status: "PUBLISHED",
      },
    });
  } else if (!course.certificateTemplateId) {
    course = await prisma.course.update({
      where: { id: course.id },
      data: { certificateTemplateId: template.id },
    });
  }

  return { courseId: course.id, templateId: template.id };
};

const issueMasteryCertificateIfEligible = async (
  userId: string | null,
  overallScore: number,
  metadata: {
    industry?: string;
    management_level?: string;
    department?: string;
  },
) => {
  if (!userId || overallScore < MASTERY_PASS_SCORE) {
    return { certificateIssued: false, certificate: null as any };
  }

  try {
    const { courseId, templateId } = await ensureMasteryCertificateAssets();
    const existing = await prisma.certificate.findFirst({
      where: { userId, courseId },
    });

    if (existing) {
      return { certificateIssued: true, certificate: existing };
    }

    try {
      const certificate = await CertificateService.issueCertificateManually(
        userId,
        courseId,
        templateId,
      );
      return {
        certificateIssued: true,
        certificate: {
          ...certificate,
          context: {
            industry: metadata.industry || "",
            management_level: metadata.management_level || "",
            department: metadata.department || "",
          },
          dashboardUrl: "https://dashboard.isobrain.ai/user/certificates",
        },
      };
    } catch (err) {
      if (isPrismaUniqueConflict(err)) {
        const again = await prisma.certificate.findFirst({
          where: { userId, courseId },
        });
        if (again) {
          return { certificateIssued: true, certificate: again };
        }
      }
      throw err;
    }
  } catch (err) {
    console.error("Mastery Lab certificate issue failed:", err);
    return { certificateIssued: false, certificate: null as any };
  }
};

const asTrustedQuestions = (raw: unknown): TrustedExamQuestion[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q: any) => ({
      id: String(q?.id || ""),
      question: String(q?.question || ""),
      options: Array.isArray(q?.options)
        ? q.options.map((o: any) => ({
            label: String(o?.label ?? ""),
            text: String(o?.text ?? ""),
          }))
        : [],
      answer: String(q?.answer ?? ""),
    }))
    .filter((q) => q.id && q.question);
};

const mapOwnershipError = (err: any): never => {
  const code = err?.code;
  if (code === "NULL_OWNER_SESSION") {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "Exam session has no owner and cannot be submitted by an authenticated user",
    );
  }
  if (code === "FOREIGN_OWNER_SESSION") {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "Exam session does not belong to this user",
    );
  }
  if (code === "UNAUTHENTICATED_SESSION") {
    throw new ApiError(
      httpStatus.UNAUTHORIZED,
      "Authentication or guest id required to submit assessment",
    );
  }
  throw err;
};

/**
 * Load sessions, enforce ownership, reject consumed sessions without an existing result.
 * Idempotent path: if primary session already has a MasteryLab row, return it.
 */
const loadAndAuthorizeSessions = async (params: {
  userId: string | null;
  guestId?: string | null;
  examSessionIds: string[];
}) => {
  const ids = Array.from(
    new Set(
      (params.examSessionIds || [])
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  );

  if (ids.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Missing examSessionId — regenerate the assessment and resubmit",
    );
  }

  const sessions = await prisma.masteryExamSession.findMany({
    where: { id: { in: ids } },
  });

  if (sessions.length !== ids.length) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "One or more exam sessions are unknown or expired",
    );
  }

  const ownerCtx = {
    userId: params.userId || null,
    guestId: params.guestId || null,
  };

  for (const session of sessions) {
    try {
      assertExamSessionOwnership(session, ownerCtx);
    } catch (err) {
      mapOwnershipError(err);
    }
  }

  const primarySessionId = sessions[0].id;
  const existingResult = await prisma.masteryLab.findFirst({
    where: { examSessionId: primarySessionId },
    orderBy: { createdAt: "asc" },
  });

  const allConsumed = sessions.every((s) => Boolean(s.consumedAt));
  if (allConsumed && existingResult) {
    return {
      kind: "idempotent" as const,
      existingResult,
      sessions,
      primarySessionId,
    };
  }

  if (sessions.some((s) => s.consumedAt) && !existingResult) {
    throw new ApiError(
      httpStatus.CONFLICT,
      "Exam session was already consumed without a recoverable result — regenerate the assessment",
    );
  }

  if (sessions.some((s) => s.consumedAt)) {
    throw new ApiError(
      httpStatus.CONFLICT,
      "One or more exam sessions are already consumed",
    );
  }

  const questions: TrustedExamQuestion[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    for (const q of asTrustedQuestions(session.questions)) {
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      questions.push(q);
    }
  }

  if (questions.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Issued exam has no scorable questions",
    );
  }

  return {
    kind: "fresh" as const,
    sessions,
    questions,
    primarySessionId,
  };
};

/**
 * Compare-and-set claim: only one concurrent request wins each session.
 * Uses updateMany filtered by ownership + consumedAt null + free/stale inFlight.
 */
const claimSessionsAtomically = async (params: {
  sessionIds: string[];
  userId: string | null;
  guestId?: string | null;
  claimToken: string;
}) => {
  const now = new Date();
  const ownerCtx = {
    userId: params.userId || null,
    guestId: params.guestId || null,
  };
  const claimed: string[] = [];

  for (const sessionId of params.sessionIds) {
    const where = buildClaimWhere(sessionId, ownerCtx, now);
    const result = await prisma.masteryExamSession.updateMany({
      where,
      data: {
        inFlightAt: now,
        inFlightToken: params.claimToken,
      },
    });

    if (result.count !== 1) {
      // Release any locks we already took with this token
      if (claimed.length) {
        await prisma.masteryExamSession.updateMany({
          where: {
            id: { in: claimed },
            inFlightToken: params.claimToken,
            AND: [unconsumedWhere()],
          },
          data: { inFlightAt: null, inFlightToken: null },
        });
      }
      throw new ApiError(
        httpStatus.CONFLICT,
        "Exam session is already in progress or consumed — retry shortly or regenerate",
      );
    }
    claimed.push(sessionId);
  }

  return claimed;
};

const releaseClaim = async (sessionIds: string[], claimToken: string) => {
  await prisma.masteryExamSession.updateMany({
    where: {
      id: { in: sessionIds },
      inFlightToken: claimToken,
      AND: [unconsumedWhere()],
    },
    data: { inFlightAt: null, inFlightToken: null },
  });
};

const finalizeConsume = async (sessionIds: string[], claimToken: string) => {
  await prisma.masteryExamSession.updateMany({
    where: {
      id: { in: sessionIds },
      inFlightToken: claimToken,
    },
    data: {
      consumedAt: new Date(),
      inFlightAt: null,
      inFlightToken: null,
    },
  });
};

const formatSubmitResponse = (
  result: any,
  extras: {
    overallScore: number;
    comparison: string;
    benchmarkAverage: number;
    weakStandards: any;
    aiFeedback: any;
    certificateIssued: boolean;
    certificate: any;
    passed: boolean;
  },
) => ({
  ...result,
  overallScore: extras.overallScore,
  benchmark: {
    industryAverage: extras.benchmarkAverage,
    comparison: extras.comparison,
  },
  weakStandards: extras.weakStandards,
  aiFeedback: extras.aiFeedback,
  certificateIssued: extras.certificateIssued,
  certificate: extras.certificate,
  passed: extras.passed,
});

const submitMasteryLab = async (payload: any) => {
  const { userId, timeTaken, metadata, answers = [], guestId } = payload;

  const examSessionIds: string[] = Array.isArray(payload.examSessionIds)
    ? payload.examSessionIds
    : payload.examSessionId
      ? [payload.examSessionId]
      : [];

  const {
    industry,
    management_level,
    department,
    suggestedStandards = [],
  } = metadata || {};

  const loaded = await loadAndAuthorizeSessions({
    userId: userId || null,
    guestId: guestId || null,
    examSessionIds,
  });

  if (loaded.kind === "idempotent") {
    const existing = loaded.existingResult;
    const passed = existing.score >= MASTERY_PASS_SCORE;
    // Safe XP retry if pass was recorded but award soft-failed previously
    if (passed && userId) {
      const { XpService } = await import("../Gamification/xp.service");
      await XpService.awardMasteryExamPass(userId, existing.id);
    }
    return formatSubmitResponse(existing, {
      overallScore: existing.score,
      comparison:
        existing.score < 78 ? "Below Average" : "Above Average",
      benchmarkAverage: 78,
      weakStandards: suggestedStandards.slice(
        Math.floor(suggestedStandards.length / 2),
      ),
      aiFeedback: existing.aiFeedback,
      certificateIssued: false,
      certificate: null,
      passed,
    });
  }

  const { questions: trusted, primarySessionId, sessions } = loaded;
  const sessionIds = sessions.map((s) => s.id);
  const claimToken = randomUUID();

  await claimSessionsAtomically({
    sessionIds,
    userId: userId || null,
    guestId: guestId || null,
    claimToken,
  });

  try {
    const trustedIds = new Set(trusted.map((q) => q.id));
    const submittedWithIds = (answers || []).filter(
      (a: any) => a?.questionId || a?.question_id,
    );
    if (submittedWithIds.length > 0) {
      const unknown = submittedWithIds.filter(
        (a: any) =>
          !trustedIds.has(String(a.questionId || a.question_id || "")),
      );
      if (unknown.length === submittedWithIds.length) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          "Submitted answers do not match the issued exam",
        );
      }
    }

    const scored = scoreAgainstTrustedExam(trusted, answers || []);
    if (!scored.total) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid answers");
    }

    const { rightAns, wrongAns, total, score: overallScore } = scored;
    const benchmarkAverage = 78;
    const comparison =
      overallScore < benchmarkAverage ? "Below Average" : "Above Average";
    const weakStandards = suggestedStandards.slice(
      Math.floor(suggestedStandards.length / 2),
    );

    const sanitizedResults = (answers || []).map((a: any) => ({
      question: a.question,
      questionId: a.questionId || a.question_id,
      selected_answer: a.selected_answer ?? a.selectedAnswer,
    }));

    let aiFeedback: any = {};
    try {
      const aiResponse = await axios.post(
        `${process.env.AI_BASE_URL}/quiz/feedback`,
        {
          context: {
            industry,
            management_level,
            department,
            suggestedStandards,
          },
          results: sanitizedResults,
          score: overallScore,
        },
      );
      aiFeedback = aiResponse?.data || {};
    } catch (err) {
      console.warn("Mastery Lab AI feedback failed:", (err as Error)?.message);
    }

    const result = await prisma.masteryLab.create({
      data: {
        userId: userId || null,
        guestId: guestId || null,
        examSessionId: primarySessionId,
        rightAns,
        wrongAns,
        total,
        score: overallScore,
        aiFeedback,
        industry,
        management_level,
        department,
        timeTaken,
        suggestedStandards,
      },
    });

    await finalizeConsume(sessionIds, claimToken);

    const certResult = await issueMasteryCertificateIfEligible(
      userId,
      overallScore,
      { industry, management_level, department },
    );

    const passed = overallScore >= MASTERY_PASS_SCORE;
    if (passed && userId) {
      const { XpService } = await import("../Gamification/xp.service");
      await XpService.awardMasteryExamPass(userId, result.id);
    }

    return formatSubmitResponse(result, {
      overallScore,
      comparison,
      benchmarkAverage,
      weakStandards,
      aiFeedback,
      certificateIssued: certResult.certificateIssued,
      certificate: certResult.certificate,
      passed,
    });
  } catch (err) {
    // Release soft lock so the legitimate owner can retry after recoverable failures
    try {
      await releaseClaim(sessionIds, claimToken);
    } catch (releaseErr) {
      console.error(
        "[MasteryLab] failed to release exam claim after error",
        String((releaseErr as Error)?.message || releaseErr).slice(0, 200),
      );
    }
    throw err;
  }
};

const getLeaderboard = async () => {
  const all = await prisma.masteryLab.findMany({
    where: {
      NOT: {
        userId: null,
      },
    },
    orderBy: { score: "desc" },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  const map = new Map();

  for (const item of all) {
    const key = item.userId;
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  const top = Array.from(map.values()).slice(0, 10);

  return top.map((item, index) => ({
    rank: index + 1,
    userId: item.user?.id,
    name: `${item.user?.firstName || ""} ${item.user?.lastName || ""}`.trim(),
    score: Math.round(item.score),
    industry: item.industry || "Unknown",
    category: item.industry || item.department || "Mastery Lab",
  }));
};

const resetLeaderboard = async () => {
  const result = await prisma.masteryLab.deleteMany({});
  return { deleted: result.count };
};

export const MasteryLabService = {
  submitMasteryLab,
  getLeaderboard,
  resetLeaderboard,
};
