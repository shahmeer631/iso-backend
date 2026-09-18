import prisma from "../../../../shared/prisma";

const createCourseNote = async (payload: any) => {
  const result = await prisma.courseNote.create({
    data: {
      userId: payload.userId,
      courseId: payload.courseId,
      content: payload.content,
    },
  });

  return result;
};

const getAllNotes = async (userId: string) => {
  const result = await prisma.courseNote.findMany({
    where: {
      userId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return result;
};

const getCourseNotes = async (userId: string, courseId: string) => {
  const result = await prisma.courseNote.findMany({
    where: {
      userId,
      courseId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return result;
};

const getSingleCourseNote = async (id: string) => {
  const result = await prisma.courseNote.findUnique({
    where: {
      id,
    },
  });
  return result;
};

const updateCourseNote = async (id: string, payload: any) => {
  const result = await prisma.courseNote.update({
    where: {
      id,
    },
    data: {
      content: payload.content,
    },
  });

  return result;
};

const deleteCourseNote = async (id: string) => {
  const result = await prisma.courseNote.delete({
    where: {
      id,
    },
  });

  return result;
};

export const CourseNoteService = {
  createCourseNote,
  getAllNotes,
  getCourseNotes,
  getSingleCourseNote,
  updateCourseNote,
  deleteCourseNote,
};
