import axios from "axios";
import prisma from "../../../shared/prisma";
import FormData from "form-data";

const createVideo = async (payload: any) => {
  // STEP 1: create video
  const video = await prisma.video.create({
    data: {
      title: payload.videoTitle || payload.title,
      description: payload.description,
      videoUrl: payload.videoUrl,
      thumbnail: payload.thumbnail || null,
      duration: payload.duration || null,
      status: payload.status || "PUBLISHED",
    },
  });

  // STEP 2: create lesson
  const lastLesson = await prisma.lesson.findFirst({
    where: {
      courseId: payload.courseId,
    },
  });

  const nextOrder = lastLesson ? lastLesson.order + 1 : 1;

  const lesson = await prisma.lesson.create({
    data: {
      title: payload.lessonTitle || payload.videoTitle || payload.title,
      courseId: payload.courseId,
      order: nextOrder,
      videoId: video.id,
    },
  });

  // STEP 3: generate quiz from AI
  try {
    // 🔥 get course + category
    const course = await prisma.course.findUnique({
      where: { id: payload.courseId },
      include: {
        category: true,
      },
    });

    // 🔥 keywords
    const keywords = [
      payload.title,
      payload.videoTitle,
      payload.lessonTitle,
      course?.title,
      course?.category?.name,
    ]
      .filter(Boolean)
      .join(", ");

    // 🔥 prepare formData
    const formData = new FormData();

    formData.append(
      "context",
      JSON.stringify({
        courseTitle: course?.title || "",
        courseDescription: course?.description || "",
        category: course?.category?.name || "",

        lessonTitle: lesson.title,

        videoTitle: payload.videoTitle || payload.title,
        videoDescription: payload.description || "",

        keywords,

        instruction:
          "Generate quiz strictly based on lesson and ISO content. Avoid generic questions.",
      }),
    );

    formData.append("num_questions", "10");
    formData.append("difficulty", "beginner");

    // 🔥 get ISO files from same category
    const standards = await prisma.iSOStandard.findMany({
      where: { categoryId: course?.categoryId },
    });

    // 🔥 pick random 2 files
    const selected = standards.sort(() => 0.5 - Math.random()).slice(0, 2);

    // 🔥 download + attach files
    for (const file of selected) {
      if (!file.fileUrl) continue;

      const fileRes = await axios.get(file.fileUrl, {
        responseType: "arraybuffer",
      });

      formData.append("files", Buffer.from(fileRes.data), {
        filename: `${file.title}.pdf`,
      });
    }

    // 🔥 call AI
    const aiResponse = await axios.post(
      process.env.AI_BASE_URL + "/quiz/generate",
      formData,
      {
        headers: formData.getHeaders(),
      },
    );

    const questions = aiResponse.data.questions || [];

    // STEP 4: create quiz
    const quiz = await prisma.quiz.create({
      data: {
        lessonId: lesson.id,
      },
    });

    // STEP 5: save questions
    const formattedQuestions = questions.map((q: any) => ({
      quizId: quiz.id,
      question: q.question,
      options: Object.values(q.options || {}),
      answer: q.correct_answer,
    }));

    if (formattedQuestions.length) {
      await prisma.quizQuestion.createMany({
        data: formattedQuestions,
      });
    }
  } catch (error) {
    console.log("Quiz generation failed:", (error as Error)?.message);
    // ❗ don't break video upload
  }

  return {
    video,
    lesson,
  };
};

const getVideos = async (query: any) => {
  const { page = 1, limit = 10, search, status, categoryId } = query;
  const skip = (Number(page) - 1) * Number(limit);
  const andConditions: any[] = [];

  if (search) {
    andConditions.push({
      title: {
        contains: search,
        mode: "insensitive",
      },
    });
  }

  if (status) {
    andConditions.push({ status });
  }

  if (categoryId) {
    andConditions.push({ categoryId });
  }

  const whereConditions = andConditions.length ? { AND: andConditions } : {};

  const result = await prisma.video.findMany({
    where: whereConditions,
    include: {
      category: true,
      lessons: {
        include: {
          quizzes: {
            include: {
              questions: true,
            },
          },
        },
      },
    },
    skip,
    take: Number(limit),
    // orderBy: {
    //   createdAt: "desc",
    // },
  });

  const total = await prisma.video.count({
    where: whereConditions,
  });

  return {
    meta: {
      page: Number(page),
      limit: Number(limit),
      total,
    },
    data: result,
  };
};

const getSingleVideo = async (id: string) => {
  return prisma.video.findUnique({
    where: { id },
    include: {
      category: true,
      lessons: {
        include: {
          quizzes: {
            include: {
              questions: true,
            },
          },
        },
      },
    },
  });
};
const updateVideo = async (id: string, payload: any) => {
  // ✅ STEP 1: update video
  const video = await prisma.video.update({
    where: { id },
    data: {
      title: payload.videoTitle || payload.title,
      description: payload.description,
      // categoryId: payload.categoryId,
      videoUrl: payload.videoUrl,
      thumbnail: payload.thumbnail,
      duration: payload.duration,
      status: payload.status,
    },
  });

  // ✅ STEP 2: update lesson title (sync)
  if (payload.lessonTitle) {
    await prisma.lesson.updateMany({
      where: {
        videoId: id,
      },
      data: {
        title: payload.lessonTitle,
      },
    });
  }

  return video;
};

const deleteVideo = async (id: string) => {
  return prisma.$transaction(async (tx) => {
    // 1. get lessons
    const lessons = await tx.lesson.findMany({
      where: { videoId: id },
      select: { id: true },
    });

    const lessonIds = lessons.map((l) => l.id);

    // 2. get quizzes
    const quizzes = await tx.quiz.findMany({
      where: { lessonId: { in: lessonIds } },
      select: { id: true },
    });

    const quizIds = quizzes.map((q) => q.id);

    // 🔥 3. delete quiz questions FIRST
    await tx.quizQuestion.deleteMany({
      where: { quizId: { in: quizIds } },
    });

    // 4. delete quizzes
    await tx.quiz.deleteMany({
      where: { lessonId: { in: lessonIds } },
    });

    // 5. delete lessons
    await tx.lesson.deleteMany({
      where: { videoId: id },
    });

    // 6. delete video
    return tx.video.delete({
      where: { id },
    });
  });
};

export const VideoServices = {
  createVideo,
  getVideos,
  getSingleVideo,
  updateVideo,
  deleteVideo,
};
