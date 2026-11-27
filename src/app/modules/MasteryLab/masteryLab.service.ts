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
import {
  buildMasteryLeaderboard,
  MASTERY_LEADERBOARD_RESET_CONFIRM,
} from "./masteryLeaderboard";
import {
  getActiveMasteryCampaign,
  MASTERY_ACTIVE_CAMPAIGN_ID,
  MASTERY_CAMPAIGN_TRANSITION_CONFIRM,
} from "../Quiz/masteryCampaign";
import {
  expireLegacyUnconsumedExamSessions,
  invalidateAllUnusedQuestionBank,
} from "../Quiz/masteryQuestionBank";
import {
  MASTERY_PASS_SCORE,
  isMasteryPassingScore,
} from "./masteryPassScore";

export {
  MASTERY_LEADERBOARD_RESET_CONFIRM,
  MASTERY_CAMPAIGN_TRANSITION_CONFIRM,
  getActiveMasteryCampaign,
  MASTERY_PASS_SCORE,
  isMasteryPassingScore,
};

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
  if (!userId || !isMasteryPassingScore(overallScore)) {
    return { certificateIssued: false, certificate: null as any };
  }

  try {
    const { courseId, templateId } = await ensureMasteryCertificateAssets();
    const existing = await prisma.certificate.findFirst({
      where: { userId, courseId },
    });

    const withShareMeta = (certificate: any) => ({
      ...certificate,
      context: {
        industry: metadata.industry || "",
        management_level: metadata.management_level || "",
        department: metadata.department || "",
      },
      dashboardUrl: "https://dashboard.isobrain.ai/user/certificates",
      // Public verify page with Open Graph tags for LinkedIn share expansion
      shareUrl: certificate?.id
        ? `https://isobrain.ai/en/verify/${certificate.id}`
        : undefined,
    });

    if (existing) {
      return {
        certificateIssued: true,
        certificate: withShareMeta(existing),
      };
    }

    try {
      const certificate = await CertificateService.issueCertificateManually(
        userId,
        courseId,
        templateId,
      );
      return {
        certificateIssued: true,
        certificate: withShareMeta(certificate),
      };
    } catch (err: any) {
      // Idempotent: unique constraint or explicit "already exists" from service
      const alreadyExists =
        isPrismaUniqueConflict(err) ||
        /already exists/i.test(String(err?.message || ""));
      if (alreadyExists) {
        const again = await prisma.certificate.findFirst({
          where: { userId, courseId },
        });
        if (again) {
          return {
            certificateIssued: true,
            certificate: withShareMeta(again),
          };
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

const isValidGuestId = (value?: string | null): value is string =>
  typeof value === "string" &&
  /^guest_[a-zA-Z0-9_-]{8,64}$/.test(value.trim());

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
    progress?: number;
    answered?: number;
    incorrectAns?: number;
    unanswered?: number;
  },
) => {
  const total = Number(result?.total) || 0;
  const rightAns = Number(result?.rightAns) || 0;
  const hasBreakdown =
    Number.isFinite(Number(extras.answered)) ||
    Number.isFinite(Number(extras.incorrectAns)) ||
    Number.isFinite(Number(extras.unanswered));
  const answered = hasBreakdown
    ? Math.min(
        total,
        Number(
          extras.answered ??
            rightAns + Math.max(0, Number(extras.incorrectAns) || 0),
        ),
      )
    : undefined;
  const incorrectAns = hasBreakdown
    ? Number(
        extras.incorrectAns ??
          Math.max(0, (answered ?? 0) - rightAns),
      )
    : undefined;
  const unanswered = hasBreakdown
    ? Number(
        extras.unanswered ??
          Math.max(0, total - (answered ?? 0)),
      )
    : undefined;
  const progress = Number.isFinite(Number(extras.progress))
    ? Number(extras.progress)
    : answered !== undefined && total > 0
      ? Number(((answered / total) * 100).toFixed(2))
      : undefined;
  const score = Number(extras.overallScore);

  return {
    ...result,
    // Authoritative test score — never confused with progress
    score,
    overallScore: score,
    ...(progress !== undefined ? { progress } : {}),
    ...(answered !== undefined ? { answered } : {}),
    ...(incorrectAns !== undefined ? { incorrectAns } : {}),
    ...(unanswered !== undefined ? { unanswered } : {}),
    rightAns,
    // Keep wrongAns as non-correct slots for historical consumers
    wrongAns: Number(result?.wrongAns) || Math.max(0, total - rightAns),
    total,
    metrics: {
      ...(progress !== undefined ? { progress } : {}),
      score,
      correct: rightAns,
      ...(incorrectAns !== undefined ? { incorrect: incorrectAns } : {}),
      ...(unanswered !== undefined ? { unanswered } : {}),
      ...(answered !== undefined ? { answered } : {}),
      total,
    },
    benchmark: {
      industryAverage: extras.benchmarkAverage,
      comparison: extras.comparison,
    },
    weakStandards: extras.weakStandards,
    aiFeedback: extras.aiFeedback,
    certificateIssued: extras.certificateIssued,
    certificate: extras.certificate,
    passed: extras.passed,
    requiresAuth: false,
    completed: true,
  };
};

/**
 * Freemium Feature 3 — anonymous visitors may complete scoring, but must not
 * receive score / feedback payloads until they authenticate and claim the result.
 */
export const redactMasteryResultForAnonymous = (result: {
  id: string;
}) => ({
  requiresAuth: true,
  completed: true,
  resultId: result.id,
  message:
    "Your assessment has been completed! Create a free account or log in to view your results.",
});

const metricsFromStoredResult = (result: any) => {
  const stored =
    result?.aiFeedback?.scoring_metrics &&
    typeof result.aiFeedback.scoring_metrics === "object"
      ? result.aiFeedback.scoring_metrics
      : null;
  if (!stored) {
    // Historical rows only stored rightAns / wrongAns / total / score.
    // Progress cannot be reconstructed when unanswered was folded into wrongAns.
    return {};
  }
  const answered = Number(stored.answered);
  const incorrectAns = Number(stored.incorrect);
  const unanswered = Number(stored.unanswered);
  const progress = Number(stored.progress);
  return {
    answered: Number.isFinite(answered) ? answered : undefined,
    incorrectAns: Number.isFinite(incorrectAns) ? incorrectAns : undefined,
    unanswered: Number.isFinite(unanswered) ? unanswered : undefined,
    progress: Number.isFinite(progress) ? progress : undefined,
  };
};

const buildResultPayload = async (result: any) => {
  const overallScore = Number(result.score) || 0;
  const passed = isMasteryPassingScore(overallScore);
  const metrics = metricsFromStoredResult(result);

  // Ensure Competency certificate is issued (or re-linked) whenever a passing
  // authenticated attempt is loaded — claim / get-result paths previously
  // hard-coded certificateIssued: false even after a successful issue.
  let certificateIssued = false;
  let certificate: any = null;
  if (result?.userId && passed) {
    const certResult = await issueMasteryCertificateIfEligible(
      String(result.userId),
      overallScore,
      {
        industry: result.industry || undefined,
        management_level: result.management_level || undefined,
        department: result.department || undefined,
      },
    );
    certificateIssued = Boolean(certResult.certificateIssued);
    certificate = certResult.certificate
      ? {
          ...certResult.certificate,
          dashboardUrl:
            certResult.certificate.dashboardUrl ||
            "https://dashboard.isobrain.ai/user/certificates",
          shareUrl:
            certResult.certificate.shareUrl ||
            (certResult.certificate.id
              ? `https://isobrain.ai/en/verify/${certResult.certificate.id}`
              : undefined),
        }
      : null;
  }

  return formatSubmitResponse(result, {
    overallScore,
    comparison: overallScore < 78 ? "Below Average" : "Above Average",
    benchmarkAverage: 78,
    weakStandards: Array.isArray(result.suggestedStandards)
      ? result.suggestedStandards.slice(
          Math.floor(result.suggestedStandards.length / 2),
        )
      : [],
    aiFeedback: result.aiFeedback || {},
    certificateIssued,
    certificate,
    passed,
    ...metrics,
  });
};

const submitMasteryLab = async (payload: any) => {
  const { userId, timeTaken, metadata, answers = [] } = payload;
  const guestId =
    !userId && isValidGuestId(payload.guestId)
      ? payload.guestId.trim()
      : !userId
        ? payload.guestId || null
        : null;

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
    // Anonymous callers never receive score details — claim after login instead
    if (!userId) {
      return redactMasteryResultForAnonymous(existing);
    }
    const passed = isMasteryPassingScore(existing.score);
    // Safe XP retry if pass was recorded but award soft-failed previously
    if (passed && userId) {
      const { XpService } = await import("../Gamification/xp.service");
      await XpService.awardMasteryExamPass(userId, existing.id);
    }
    // Re-use async payload builder so certificate appears on dashboard + API
    return buildResultPayload(existing);
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

    const {
      rightAns,
      wrongAns,
      total,
      score: overallScore,
      progress,
      answered,
      incorrectAns,
      unanswered,
    } = scored;
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
          progress,
          metrics: {
            correct: rightAns,
            incorrect: incorrectAns,
            unanswered,
            answered,
            total,
          },
          report_schema: {
            strengths_summary:
              "Praise for passed clauses / competencies (short).",
            weaknesses_summary:
              "Operational vulnerabilities based on failed clauses (short).",
            library_upsell:
              "Recommend standards to read; always include URL https://isobrain.ai/en/library/iso-standards",
            academy_upsell:
              "Recommend masterclasses; always include URL https://isobrain.ai/en/academy",
            ai_assistant_upsell:
              "Pitch daily guidance; always include URL https://isobrain.ai/en/ai-assistant-home",
          },
        },
      );
      aiFeedback = aiResponse?.data || {};
    } catch (err) {
      console.warn("Mastery Lab AI feedback failed:", (err as Error)?.message);
    }

    // Persist metrics snapshot + hardcoded upsell URLs (implementation plan)
    const aiFeedbackWithMetrics = {
      ...(aiFeedback && typeof aiFeedback === "object" ? aiFeedback : {}),
      library_upsell: {
        ...(typeof aiFeedback?.library_upsell === "object"
          ? aiFeedback.library_upsell
          : { text: aiFeedback?.library_upsell }),
        url: "https://isobrain.ai/en/library/iso-standards",
      },
      academy_upsell: {
        ...(typeof aiFeedback?.academy_upsell === "object"
          ? aiFeedback.academy_upsell
          : { text: aiFeedback?.academy_upsell }),
        url: "https://isobrain.ai/en/academy",
      },
      ai_assistant_upsell: {
        ...(typeof aiFeedback?.ai_assistant_upsell === "object"
          ? aiFeedback.ai_assistant_upsell
          : { text: aiFeedback?.ai_assistant_upsell }),
        url: "https://isobrain.ai/en/ai-assistant-home",
      },
      scoring_metrics: {
        progress,
        score: overallScore,
        correct: rightAns,
        incorrect: incorrectAns,
        unanswered,
        answered,
        total,
      },
    };

    const result = await prisma.masteryLab.create({
      data: {
        userId: userId || null,
        guestId: guestId || null,
        examSessionId: primarySessionId,
        rightAns,
        wrongAns,
        total,
        score: overallScore,
        aiFeedback: aiFeedbackWithMetrics,
        industry,
        management_level,
        department,
        timeTaken,
        suggestedStandards,
        // New attempts are eligible after a soft leaderboard reset
        leaderboardEligible: true,
        campaignId: MASTERY_ACTIVE_CAMPAIGN_ID,
      },
    });

    await finalizeConsume(sessionIds, claimToken);

    const certResult = await issueMasteryCertificateIfEligible(
      userId,
      overallScore,
      { industry, management_level, department },
    );

    const passed = isMasteryPassingScore(overallScore);
    if (passed && userId) {
      const { XpService } = await import("../Gamification/xp.service");
      await XpService.awardMasteryExamPass(userId, result.id);
    }

    // Freemium: score is stored, but anonymous clients only get a claim handle
    if (!userId) {
      return redactMasteryResultForAnonymous(result);
    }

    const certificate = certResult.certificate
      ? {
          ...certResult.certificate,
          dashboardUrl:
            certResult.certificate.dashboardUrl ||
            "https://dashboard.isobrain.ai/user/certificates",
          shareUrl: certResult.certificate.id
            ? `https://dashboard.isobrain.ai/certificates/${certResult.certificate.id}`
            : undefined,
        }
      : null;

    return formatSubmitResponse(result, {
      overallScore,
      comparison,
      benchmarkAverage,
      weakStandards,
      aiFeedback: aiFeedbackWithMetrics,
      certificateIssued: certResult.certificateIssued,
      certificate,
      passed,
      progress,
      answered,
      incorrectAns,
      unanswered,
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

/**
 * Leaderboard is derived from MasteryLab attempts (best score per authenticated user).
 * It is NOT driven by Gamification XP. Soft-reset hides attempts via leaderboardEligible
 * without deleting historical results.
 */
const getLeaderboard = async (opts?: {
  filter?: "global" | "industry" | "management_level";
  industry?: string | null;
  managementLevel?: string | null;
}) => {
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
          isLeaderboardPublic: true,
        },
      },
    },
  });

  return buildMasteryLeaderboard(all as any, 100, {
    filter: opts?.filter || "global",
    industry: opts?.industry,
    managementLevel: opts?.managementLevel,
  });
};

/**
 * Soft-reset leaderboard (+ optional full campaign transition).
 *
 * Accepts either:
 * - RESET_MASTERY_LEADERBOARD — hide ranks only
 * - CLOSE_PREVIOUS_START_KNOWLEDGE_V1 — hide ranks + invalidate legacy question bank
 *   + expire unconsumed non-active-campaign exam sessions
 *
 * Does NOT delete MasteryLab rows, certificates, users, or global XP ledgers.
 */
const resetLeaderboard = async (params: {
  adminUserId: string;
  confirm: string;
  note?: string;
}) => {
  const confirm = String(params.confirm || "").trim();
  const allowed = new Set([
    MASTERY_LEADERBOARD_RESET_CONFIRM,
    MASTERY_CAMPAIGN_TRANSITION_CONFIRM,
  ]);
  if (!allowed.has(confirm)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Confirmation required. Send body.confirm = "${MASTERY_LEADERBOARD_RESET_CONFIRM}" or "${MASTERY_CAMPAIGN_TRANSITION_CONFIRM}"`,
    );
  }

  if (!params.adminUserId) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Admin identity required");
  }

  const campaign = getActiveMasteryCampaign();
  const isCampaignTransition =
    confirm === MASTERY_CAMPAIGN_TRANSITION_CONFIRM;

  const beforeRows = await prisma.masteryLab.findMany({
    where: { NOT: { userId: null } },
    select: { id: true, leaderboardEligible: true },
  });
  const beforeVisible = beforeRows.filter(
    (r) => (r as any).leaderboardEligible !== false,
  ).length;

  // Hide every attempt from leaderboard rankings (historical rows kept)
  const updated = await prisma.masteryLab.updateMany({
    data: { leaderboardEligible: false },
  });

  let bankInvalidated = 0;
  let sessionsExpired = 0;
  if (isCampaignTransition) {
    bankInvalidated = await invalidateAllUnusedQuestionBank();
    sessionsExpired = await expireLegacyUnconsumedExamSessions(
      campaign.campaignId,
    );
  }

  const audit = await prisma.masteryLeaderboardResetLog.create({
    data: {
      adminUserId: params.adminUserId,
      confirmPhrase: confirm,
      hiddenCount: updated.count,
      note: params.note?.slice(0, 500) || null,
      campaignId: campaign.campaignId,
      bankInvalidated,
      sessionsExpired,
    } as any,
  });

  return {
    mode: isCampaignTransition
      ? ("campaign_transition_soft_hide" as const)
      : ("soft_hide" as const),
    campaign,
    previousCampaignClosed: campaign.previousCampaignId,
    hiddenCount: updated.count,
    previouslyVisibleApprox: beforeVisible,
    bankInvalidated,
    sessionsExpired,
    deleted: 0,
    preserved: {
      masteryLabAttempts: true,
      examSessions: true,
      historicalScores: true,
      certificates: true,
      userAccounts: true,
      xpLedgers: true,
      academyProgress: true,
      isoLibrary: true,
    },
    audit: {
      id: audit.id,
      adminUserId: audit.adminUserId,
      createdAt: audit.createdAt,
      hiddenCount: audit.hiddenCount,
      campaignId: campaign.campaignId,
    },
    message: isCampaignTransition
      ? "Previous Mastery Lab campaign closed. Leaderboard soft-reset; legacy question bank invalidated; unconsumed legacy sessions expired. New knowledge-based attempts use the active campaign."
      : "Mastery Lab leaderboard soft-reset complete. Historical attempts remain available; new submissions will appear on the leaderboard.",
  };
};

const getMasteryLabResult = async (userId: string, resultId: string) => {
  const result = await prisma.masteryLab.findUnique({
    where: { id: resultId },
  });

  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, "Assessment result not found");
  }

  if (!result.userId || result.userId !== userId) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "You are not authorized to view this assessment result",
    );
  }

  return buildResultPayload(result);
};

/**
 * Securely attach a guest-completed Mastery Lab attempt to the authenticated user.
 * Requires matching guestId — arbitrary result IDs cannot be claimed.
 */
const claimMasteryLabResult = async (
  userId: string,
  resultId: string,
  guestId: string,
) => {
  if (!isValidGuestId(guestId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Invalid guest identity");
  }

  const result = await prisma.masteryLab.findUnique({
    where: { id: resultId },
  });

  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, "Assessment result not found");
  }

  if (result.userId && result.userId === userId) {
    return buildResultPayload(result);
  }

  if (result.userId && result.userId !== userId) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "This assessment result belongs to another account",
    );
  }

  if (!result.guestId || result.guestId !== guestId.trim()) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "Pending assessment attempt could not be verified for this session",
    );
  }

  const updated = await prisma.masteryLab.update({
    where: { id: resultId },
    data: { userId },
  });

  const passed = isMasteryPassingScore(updated.score);
  if (passed) {
    try {
      const { XpService } = await import("../Gamification/xp.service");
      await XpService.awardMasteryExamPass(userId, updated.id);
    } catch (err) {
      console.error(
        "[MasteryLab] XP award after claim failed",
        String((err as Error)?.message || err).slice(0, 200),
      );
    }
  }

  // buildResultPayload re-issues / links the Competency certificate and returns
  // certificateIssued so the success page + dashboard stay in sync.
  return buildResultPayload(updated);
};

export const MasteryLabService = {
  submitMasteryLab,
  getLeaderboard,
  resetLeaderboard,
  getMasteryLabResult,
  claimMasteryLabResult,
};
