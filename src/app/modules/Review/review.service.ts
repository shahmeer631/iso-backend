import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import { userHasFeatureAccess } from "../../../helpars/effectiveAccess";

const createReview = async (payload: any) => {
  const { userId, courseId, rating, comment } = payload;

  // COURSES access from subscription ∪ user groups (SUPER_ADMIN bypasses inside helper)
  const canReview = await userHasFeatureAccess(userId, "COURSES");
  if (!canReview) {
    throw new ApiError(403, "Course access required to leave a review");
  }

  return prisma.review.create({
    data: {
      userId,
      courseId,
      rating,
      comment,
    },
  });
};

const getReviews = async (query: any) => {
  const { page = 1, limit = 10, status, search } = query;
  const skip = (Number(page) - 1) * Number(limit);
  const where: any = {};

  if (status && status !== "ALL") {
    where.status = status;
  }

  if (search) {
    where.OR = [
      {
        user: {
          firstName: { contains: search, mode: "insensitive" },
        },
      },
      {
        course: {
          title: { contains: search, mode: "insensitive" },
        },
      },
    ];
  }

  // 🔥 list
  const data = await prisma.review.findMany({
    where,
    skip,
    take: Number(limit),
    orderBy: { createdAt: "desc" },
    include: {
      user: true,
      course: true,
    },
  });

  const total = await prisma.review.count({ where });

  // 🔥 stats
  const allReviews = await prisma.review.findMany();
  const totalReviews = allReviews.length;

  const avgRating =
    totalReviews === 0
      ? 0
      : allReviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews;

  const fiveStar = allReviews.filter((r) => r.rating === 5).length;

  const fiveStarRate =
    totalReviews === 0 ? 0 : Math.round((fiveStar / totalReviews) * 100);

  // 🔥 distribution
  const distribution = [5, 4, 3, 2, 1].map((star) => {
    const count = allReviews.filter((r) => r.rating === star).length;
    return {
      star,
      count,
      percentage:
        totalReviews === 0 ? 0 : Math.round((count / totalReviews) * 100),
    };
  });

  return {
    meta: {
      page: Number(page),
      limit: Number(limit),
      total,
    },
    stats: {
      avgRating: Number(avgRating.toFixed(1)),
      totalReviews,
      fiveStar,
      fiveStarRate,
    },
    distribution,
    data,
  };
};

export const ReviewServices = {
  createReview,
  getReviews,
};
