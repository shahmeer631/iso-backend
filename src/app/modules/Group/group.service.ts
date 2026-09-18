import { PrismaClient } from "@prisma/client";
import ApiError from "../../../errors/ApiErrors";
import httpStatus from "http-status";

const prisma = new PrismaClient();

const createGroup = async (payload: any) => {
  const result = await prisma.group.create({
    data: payload,
  });

  return result;
};

const getAllGroups = async (query: any) => {
  const { page = 1, limit = 10, search, status } = query;
  const skip = (Number(page) - 1) * Number(limit);

  const andConditions: any[] = [];

  if (search) {
    andConditions.push({
      name: {
        contains: search,
        mode: "insensitive",
      },
    });
  }

  if (status) {
    andConditions.push({
      status,
    });
  }

  const whereConditions = andConditions.length ? { AND: andConditions } : {};

  const groups = await prisma.group.findMany({
    where: whereConditions,
    skip,
    take: Number(limit),
    orderBy: {
      createdAt: "desc",
    },
    include: {
      _count: {
        select: {
          groupUsers: true, // 🔥 relation name (important)
        },
      },
    },
  });

  const total = await prisma.group.count({
    where: whereConditions,
  });

  const totalPage = Math.ceil(total / Number(limit));

  // 🔥 clean response for UI
  const result = groups.map((group) => ({
    ...group,
    memberCount: group._count.groupUsers,
  }));

  return {
    meta: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPage,
    },
    data: result,
  };
};

const getSingleGroup = async (id: string) => {
  const result = await prisma.group.findUnique({
    where: { id },
  });

  return result;
};

const updateGroup = async (id: string, payload: any) => {
  const result = await prisma.group.update({
    where: { id },
    data: payload,
  });

  return result;
};

const deleteGroup = async (id: string) => {
  const result = await prisma.group.delete({
    where: { id },
  });

  return result;
};

const addUsersToGroup = async (groupId: string, userIds: string[]) => {
  const existing = await prisma.groupUser.findMany({
    where: {
      groupId,
      userId: { in: userIds },
    },
    select: { userId: true },
  });

  const existingUserIds = existing.map((e) => e.userId);
  const newUsers = userIds.filter((id) => !existingUserIds.includes(id));

  const data = newUsers.map((userId) => ({
    groupId,
    userId,
  }));

  if (data.length > 0) {
    await prisma.groupUser.createMany({
      data,
    });
  }

  return { message: "Users added to group" };
};

export const GroupService = {
  createGroup,
  getAllGroups,
  getSingleGroup,
  updateGroup,
  deleteGroup,
  addUsersToGroup,
};
