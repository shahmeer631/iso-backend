import httpStatus from "http-status";
import ApiError from "../errors/ApiErrors";
import prisma from "../shared/prisma";
import { userHasFeatureAccess } from "./effectiveAccess";

/**
 * Freemium Feature 2 — Academy first-two-lessons-free.
 *
 * Data model note: Academy has Course → Lesson (no Module entity).
 * Client "module" maps to Course; free allowance is per course, by Lesson.order ASC.
 */
export const FREE_LESSONS_PER_COURSE = 2;
export const COURSES_FEATURE = "COURSES";
export const ACADEMY_LESSON_LOCKED_CODE = "ACADEMY_LESSON_LOCKED";

export type LessonAccessDecision = {
  allowed: boolean;
  /** 1-based index within the course when sorted by Lesson.order ASC */
  rank: number | null;
  isFreePreview: boolean;
  hasPremiumAccess: boolean;
};

/** True when the account may open every lesson in Academy courses. */
export const userHasFullCourseAccess = async (
  userId?: string | null,
): Promise<boolean> => {
  if (!userId) return false;
  return userHasFeatureAccess(userId, COURSES_FEATURE);
};

export const isFreeLessonRank = (rank: number): boolean =>
  Number.isFinite(rank) && rank >= 1 && rank <= FREE_LESSONS_PER_COURSE;

/**
 * Trusted rank: position among lessons of this course ordered by `order` ASC.
 * Does not trust client-supplied indexes.
 */
export const getLessonAccessRank = async (
  courseId: string,
  lessonId: string,
): Promise<number | null> => {
  const lessons = await prisma.lesson.findMany({
    where: { courseId },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  const index = lessons.findIndex((lesson) => lesson.id === lessonId);
  return index === -1 ? null : index + 1;
};

export const canAccessLessonContent = async (
  userId: string | undefined | null,
  courseId: string,
  lessonId: string,
): Promise<LessonAccessDecision> => {
  const rank = await getLessonAccessRank(courseId, lessonId);
  if (rank == null) {
    return {
      allowed: false,
      rank: null,
      isFreePreview: false,
      hasPremiumAccess: false,
    };
  }

  const hasPremiumAccess = await userHasFullCourseAccess(userId);
  if (hasPremiumAccess) {
    return {
      allowed: true,
      rank,
      isFreePreview: false,
      hasPremiumAccess: true,
    };
  }

  const isFreePreview = isFreeLessonRank(rank);
  return {
    allowed: isFreePreview,
    rank,
    isFreePreview,
    hasPremiumAccess: false,
  };
};

export const assertCanAccessLessonContent = async (
  userId: string | undefined | null,
  courseId: string,
  lessonId: string,
): Promise<LessonAccessDecision> => {
  const decision = await canAccessLessonContent(userId, courseId, lessonId);
  if (!decision.allowed) {
    const err = new ApiError(
      httpStatus.FORBIDDEN,
      "Unlock this lesson with Premium access.",
    );
    (err as any).code = ACADEMY_LESSON_LOCKED_CODE;
    throw err;
  }
  return decision;
};

/** Strip protected fields from a locked lesson while keeping list metadata. */
export const redactLockedLesson = <T extends Record<string, any>>(
  lesson: T,
  rank: number,
): T & {
  isLocked: true;
  isFreePreview: false;
  freeAccessRank: number;
} => {
  const {
    content: _content,
    video: _video,
    videoId: _videoId,
    quizzes: _quizzes,
    pdfUrl: _pdfUrl,
    documents: _documents,
    ...safe
  } = lesson;

  return {
    ...(safe as T),
    content: null,
    video: null,
    videoId: null,
    quizzes: [],
    pdfUrl: null,
    isLocked: true,
    isFreePreview: false,
    freeAccessRank: rank,
  };
};

/**
 * Annotate + redact course lessons for the requesting viewer.
 * Premium / COURSES-entitled users receive full content.
 * Others receive full content only for the first two lessons (by order).
 */
export const applyAcademyLessonAccessToCourse = async <
  T extends { lessons?: any[] },
>(
  course: T,
  userId?: string | null,
): Promise<
  T & {
    hasFullAccess: boolean;
    freeLessonLimit: number;
    lessons: any[];
  }
> => {
  const hasFullAccess = await userHasFullCourseAccess(userId);
  const lessons = Array.isArray(course.lessons) ? [...course.lessons] : [];
  lessons.sort((a, b) => Number(a.order) - Number(b.order));

  const secured = lessons.map((lesson, index) => {
    const rank = index + 1;
    const isFreePreview = isFreeLessonRank(rank);
    const isLocked = !hasFullAccess && !isFreePreview;

    if (isLocked) {
      return redactLockedLesson(lesson, rank);
    }

    return {
      ...lesson,
      isLocked: false,
      isFreePreview: !hasFullAccess && isFreePreview,
      freeAccessRank: rank,
    };
  });

  return {
    ...course,
    hasFullAccess,
    freeLessonLimit: FREE_LESSONS_PER_COURSE,
    lessons: secured,
  };
};

/** Apply the same redaction rules to a flat lesson list known to belong to one course. */
export const applyAcademyLessonAccessToLessonList = async (
  lessons: any[],
  userId?: string | null,
): Promise<any[]> => {
  const hasFullAccess = await userHasFullCourseAccess(userId);
  const sorted = [...lessons].sort(
    (a, b) => Number(a.order) - Number(b.order),
  );

  return sorted.map((lesson, index) => {
    const rank = index + 1;
    const isFreePreview = isFreeLessonRank(rank);
    const isLocked = !hasFullAccess && !isFreePreview;
    if (isLocked) return redactLockedLesson(lesson, rank);
    return {
      ...lesson,
      isLocked: false,
      isFreePreview: !hasFullAccess && isFreePreview,
      freeAccessRank: rank,
    };
  });
};

/**
 * Whether a video may be returned in full for this viewer.
 * Videos not attached to any Academy lesson stay unchanged (legacy public catalog).
 */
export const canAccessVideoContent = async (
  userId: string | undefined | null,
  videoId: string,
): Promise<boolean> => {
  if (await userHasFullCourseAccess(userId)) return true;

  const linkedLessons = await prisma.lesson.findMany({
    where: { videoId },
    select: { id: true, courseId: true },
  });

  // Not an Academy-bound video — leave existing public video catalog behavior
  if (linkedLessons.length === 0) return true;

  for (const lesson of linkedLessons) {
    const decision = await canAccessLessonContent(
      userId,
      lesson.courseId,
      lesson.id,
    );
    if (decision.allowed) return true;
  }

  return false;
};
