import prisma from "../../../shared/prisma";

// CREATE
const createCommunity = async (payload: any) => {
  const result = await prisma.community.create({
    data: {
      name: payload.name,
      description: payload.description,
      categoryId: payload.categoryId,
      visibility: payload.visibility || "PUBLIC",
      icon: payload.icon || null,

      allowPosts: payload.allowPosts ?? true,
      requireApproval: payload.requireApproval ?? false,
      allowAttachments: payload.allowAttachments ?? true,
      emailNotifications: payload.emailNotifications ?? true,

      memberLimit: payload.memberLimit ?? null,
      moderators: payload.moderators || [], // ✅ ADDED

      rules: payload.rules || null,

      membersCount: 0,
      postsCount: 0,
      engagement: "Low",
    },
  });

  return result;
};

// GET ALL
const getCommunities = async (query: any) => {
  const { search, visibility, page = 1, limit = 10 } = query;
  const skip = (Number(page) - 1) * Number(limit);

  const where: any = {};

  if (search) {
    where.name = {
      contains: search,
      mode: "insensitive",
    };
  }

  if (visibility) {
    where.visibility = visibility;
  }

  const result = await prisma.community.findMany({
    where,
    skip,
    take: Number(limit),
    orderBy: { createdAt: "desc" },
    include: {
      category: true,
    },
  });

  const total = await prisma.community.count({ where });

  return {
    meta: {
      page: Number(page),
      limit: Number(limit),
      total,
    },
    data: result,
  };
};

// GET SINGLE
const getSingleCommunity = async (id: string) => {
  return prisma.community.findUnique({
    where: { id },
  });
};

// UPDATE
const updateCommunity = async (id: string, payload: any) => {
  const result = await prisma.community.update({
    where: { id },
    data: payload,
  });

  return result;
};

// DELETE
const deleteCommunity = async (id: string) => {
  return prisma.community.delete({
    where: { id },
  });
};

export const CommunityService = {
  createCommunity,
  getCommunities,
  getSingleCommunity,
  updateCommunity,
  deleteCommunity,
};
