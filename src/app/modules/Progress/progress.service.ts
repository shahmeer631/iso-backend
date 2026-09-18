import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import httpStatus from "http-status";

const markLessonComplete = async (
  userId: string,
  lessonId: string,
  passed: boolean,
) => {
  if (!passed) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Quiz not passed");
  }

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
