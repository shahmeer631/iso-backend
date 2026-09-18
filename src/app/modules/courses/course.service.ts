import slugify from "slugify";
import prisma from "../../../shared/prisma";

const createCourse = async (payload: any) => {
  const slug = slugify(payload.title, { lower: true, strict: true });

  const result = await prisma.course.create({
    data: {
      title: payload.title,
      slug,
      instructor: payload.instructor,
      director: payload.director,
      description: payload.description || null,
      categoryId: payload.categoryId,
      cpdHours: payload.cpdHours ? Number(payload.cpdHours) : null,
      thumbnail: payload.thumbnail || null,
      status: payload.status || "DRAFT",
    },
    include: {
      category: true,
    },
  });

  return result;
};

const getCourses = async (query: any) => {
  const { page = 1, limit = 10, search, categoryId, status } = query;

  const skip = (Number(page) - 1) * Number(limit);

  const whereConditions: any = {};

  if (search) {
    whereConditions.OR = [
      {
        title: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        instructor: {
          contains: search,
          mode: "insensitive",
        },
      },
    ];
  }

  if (categoryId) {
    whereConditions.categoryId = categoryId;
  }

  if (status) {
    whereConditions.status = status;
  }

  const result = await prisma.course.findMany({
    where: whereConditions,
    include: {
      category: true,

      // ✅ UPDATED: add lesson count instead of loading full lessons
      _count: {
        select: {
          lessons: true,
        },
      },
    },
    skip,
    take: Number(limit),
    orderBy: {
      createdAt: "desc",
    },
  });

  const total = await prisma.course.count({
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

const getAllCoursesName = async () => {
  const result = await prisma.course.findMany({
    select: {
      id: true,
      title: true,
      slug: true,
    },
  });

  return result;
};

const getSingleCourse = async (id: string) => {
  const result = await prisma.course.findUnique({
    where: { id },
    include: {
      category: true,

      // ✅ UPDATED: include lessons with proper ordering + nested data
      lessons: {
        orderBy: {
          order: "asc",
        },
        include: {
          video: true,
          quizzes: {
            include: {
              questions: true,
            },
          },
        },
      },
    },
  });

  // 👇 TODO_REMOVE_LATER: Smart matching logic for ISO Standard
  // When isoStandardId is added directly to Course model, you can remove this block.
  if (result && result.categoryId) {
    const categoryStandards = await prisma.iSOStandard.findMany({
      where: { categoryId: result.categoryId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });

    let matchedStandard = null;

    if (categoryStandards.length === 1) {
      // If there's only 1 standard in this category, pick it
      matchedStandard = categoryStandards[0];
    } else if (categoryStandards.length > 1) {
      // 1. Bundle Check: See if this course is in a bundle with an ISO standard
      try {
        const bundleWithCourse = await prisma.bundleItem.findFirst({
          where: { itemId: id, itemType: "COURSE" },
          include: {
            bundle: {
              include: {
                bundleItems: true,
              },
            },
          },
        });

        if (bundleWithCourse && bundleWithCourse.bundle) {
          // Find if this bundle also contains an ISO standard
          const standardInBundle = bundleWithCourse.bundle.bundleItems?.find(
            (item) => item.itemType === "ISO_STANDARD"
          );
          if (standardInBundle) {
            matchedStandard = categoryStandards.find(
              (s) => s.id === standardInBundle.itemId
            );
          }
        }
      } catch (error) {
        console.error("Bundle check for ISO standard failed, falling back to title match", error);
        // We suppress the error so it doesn't break the course API
      }

      // 2. Title matching (case insensitive) fallback
      if (!matchedStandard) {
        matchedStandard = categoryStandards.find((standard) =>
          result.title.toLowerCase().includes(standard.title.toLowerCase())
        );
      }

      // 3. Fallback: take the latest one if no match found
      if (!matchedStandard) {
        matchedStandard = categoryStandards[0];
      }
    }

    // Attach it to the result object
    (result as any).isoStandard = matchedStandard;
  }
  // 👆 END_TODO_REMOVE_LATER

  return result;
};

const updateCourse = async (id: string, payload: any) => {
  const data: any = { ...payload };

  if (payload.title) {
    data.slug = slugify(payload.title, { lower: true, strict: true });
  }

  if (payload.cpdHours) {
    data.cpdHours = Number(payload.cpdHours);
  }

  const result = await prisma.course.update({
    where: { id },
    data,
    include: {
      category: true,
    },
  });

  return result;
};

const deleteCourse = async (id: string) => {
  return prisma.$transaction(async (tx) => {
    // 🔥 1. get lessons
    const lessons = await tx.lesson.findMany({
      where: { courseId: id },
      select: { id: true },
    });

    const lessonIds = lessons.map((l) => l.id);

    // 🔥 2. get quizzes
    const quizzes = await tx.quiz.findMany({
      where: { lessonId: { in: lessonIds } },
      select: { id: true },
    });

    const quizIds = quizzes.map((q) => q.id);

    // 🔥 3. delete quiz questions FIRST
    await tx.quizQuestion.deleteMany({
      where: { quizId: { in: quizIds } },
    });

    // 🔥 4. delete quizzes
    await tx.quiz.deleteMany({
      where: { id: { in: quizIds } },
    });

    // 🔥 5. delete lessons
    await tx.lesson.deleteMany({
      where: { courseId: id },
    });

    // 🔥 6. other relations
    await tx.enrollment.deleteMany({
      where: { courseId: id },
    });

    await tx.review.deleteMany({
      where: { courseId: id },
    });

    await tx.certificate.deleteMany({
      where: { courseId: id },
    });

    // 🔥 7. finally delete course
    return tx.course.delete({
      where: { id },
    });
  });
};

const completeCourse = async (userId: string, courseId: string) => {
  // 🔍 find enrollment
  const enrollment = await prisma.enrollment.findFirst({
    where: { userId, courseId },
  });

  if (!enrollment) {
    throw new Error("Enrollment not found");
  }

  // ✅ already completed
  if (enrollment.completed) {
    return { message: "Already completed" };
  }

  // 🔥 mark completed
  await prisma.enrollment.update({
    where: { id: enrollment.id },
    data: {
      progress: 100,
      completed: true,
    },
  });

  // 🔍 course + template
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { certificateTemplate: true },
  });

  console.log("COURSE:", course);
  console.log("TEMPLATE:", course?.certificateTemplate);

  // 🔥 AUTO ISSUE CERTIFICATE
  if (!course?.certificateTemplate) {
    console.log("❌ No template assigned to course");
  }

  if (course?.certificateTemplate && course.certificateTemplate.autoIssue) {
    console.log("✅ Auto issue triggered");

    const exists = await prisma.certificate.findFirst({
      where: { userId, courseId },
    });

    if (!exists) {
      console.log("🆕 Creating certificate...");

      await prisma.certificate.create({
        data: {
          userId,
          courseId,
          templateId: course.certificateTemplate.id,
        },
      });
    }
  }

  return { message: "Course completed successfully" };
};

export const CourseService = {
  createCourse,
  getCourses,
  getAllCoursesName,
  getSingleCourse,
  updateCourse,
  deleteCourse,
  completeCourse,
};
