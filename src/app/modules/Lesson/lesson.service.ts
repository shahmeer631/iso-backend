import prisma from "../../../shared/prisma";

const createLesson = async (payload: any) => {
  const lastLesson = await prisma.lesson.findFirst({
    where: {
      courseId: payload.courseId,
    },
    orderBy: {
      order: "desc",
    },
  });

  const nextOrder = lastLesson ? lastLesson.order + 1 : 1;

  const result = await prisma.lesson.create({
    data: {
      title: payload.title,
      content: payload.content || null,
      courseId: payload.courseId,
      order: nextOrder,
    },
  });

  return result;
};

const getLessonsByCourse = async (courseId: string) => {
  const result = await prisma.lesson.findMany({
    where: {
      courseId,
    },
    orderBy: {
      order: "asc",
    },
    include: {
      video: true,
      quizzes: true,
    },
  });

  return result;
};

const getAllLessons = async () => {
  const result = await prisma.lesson.findMany();
  return result;
};

const getSingleLesson = async (id: string) => {
  const result = await prisma.lesson.findUnique({
    where: {
      id,
    },
    include: {
      video: true,
      quizzes: {
        include: {
          questions: true,
        },
      },
    },
  });

  return result;
};

const updateLesson = async (id: string, payload: any) => {
  const result = await prisma.lesson.update({
    where: {
      id,
    },
    data: {
      title: payload.title,
      content: payload.content,
    },
  });

  return result;
};

const deleteLesson = async (id: string) => {
  const result = await prisma.lesson.delete({
    where: {
      id,
    },
  });

  return result;
};

export const LessonService = {
  createLesson,
  getLessonsByCourse,
  getAllLessons,
  getSingleLesson,
  updateLesson,
  deleteLesson,
};
