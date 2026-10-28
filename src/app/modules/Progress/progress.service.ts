import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import httpStatus from "http-status";
import { scoreLessonQuizStrict } from "../Gamification/xp.integrity";

type LessonAnswerSubmission = {
  questionId?: string;
  selected?: string;
};

/**
 * Mark a lesson complete using server-authoritative rules:
 * - Lessons with a Quiz require trusted QuizQuestion answers (client `passed` ignored).
 * - Lessons without a quiz are informational and may be marked complete when enrolled.
 */
const markLessonComplete = async (
  userId: string,
  lessonId: string,
  _clientPassed?: boolean,
  answers?: LessonAnswerSubmission[],
) => {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { courseId: true },
  });

  if (!lesson) {
    throw new ApiError(httpStatus.NOT_FOUND, "Lesson not found");
  }

  const courseId = lesson.courseId;

  const enrollment = await prisma.enrollment.findFirst({
    where: {
      userId,
      courseId,
    },
  });

  if (!enrollment) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "You are not enrolled in this course",
    );
  }

  const quiz = await prisma.quiz.findUnique({
    where: { lessonId },
    include: { questions: true },
  });

  if (quiz && quiz.questions.length > 0) {
    const trusted = quiz.questions.map((q) => ({
      id: q.id,
      answer: q.answer,
      options: q.options || [],
    }));
    const scored = scoreLessonQuizStrict(trusted, answers || []);
    if (!scored.passed) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Lesson quiz not passed — answers must match the issued questions",
      );
    }
  }
  // Informational lessons (no quiz): allow completion without client pass flag

  const existing = await prisma.lessonProgress.findFirst({
    where: {
      userId,
      lessonId,
    },
  });

  if (!existing) {
    await prisma.lessonProgress.create({
      data: {
        userId,
        lessonId,
        completed: true,
        courseId,
      },
    });
  } else if (!existing.completed) {
    await prisma.lessonProgress.update({
      where: { id: existing.id },
      data: { completed: true },
    });
  }

  const totalLessons = await prisma.lesson.count({
    where: { courseId },
  });

  const completedLessons = await prisma.lessonProgress.count({
    where: {
      userId,
      completed: true,
      lesson: {
        courseId,
      },
    },
  });

  const progress =
    totalLessons === 0 ? 0 : (completedLessons / totalLessons) * 100;

  await prisma.enrollment.updateMany({
    where: {
      userId,
      courseId,
    },
    data: {
      progress,
    },
  });

  // Align enrollment.completed with full lesson completion, then finalize rewards
  // (XP + certificate) with Phase 3.2 idempotent recovery semantics.
  if (progress >= 100 && totalLessons > 0) {
    if (!enrollment.completed) {
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { progress: 100, completed: true },
      });
    }
    const { CourseService } = await import("../courses/course.service");
    await CourseService.finalizeCourseCompletionRewards(userId, courseId);
  }

  return {
    progress: Math.round(progress),
    completedLessons,
    totalLessons,
  };
};

const getCourseWithProgress = async (userId: string, courseId: string) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      lessons: {
        orderBy: { order: "asc" },
      },
    },
  });

  if (!course) {
    throw new ApiError(httpStatus.NOT_FOUND, "Course not found");
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: {
      userId,
      courseId,
    },
  });

  if (!enrollment) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "You are not enrolled in this course",
    );
  }

  const progresses = await prisma.lessonProgress.findMany({
    where: {
      userId,
      lesson: {
        courseId,
      },
    },
  });

  const progressMap = new Map(progresses.map((p) => [p.lessonId, p.completed]));

  let previousCompleted = false;

  const lessons = course.lessons.map((lesson) => {
    const completed = progressMap.get(lesson.id) || false;
    const isUnlocked = lesson.order === 1 || previousCompleted === true;
    previousCompleted = completed;

    return {
      ...lesson,
      isCompleted: completed,
      isUnlocked,
    };
  });

  return {
    id: course.id,
    title: course.title,
    lessons,
    progress: enrollment.progress,
  };
};

export const ProgressServices = {
  markLessonComplete,
  getCourseWithProgress,
};
