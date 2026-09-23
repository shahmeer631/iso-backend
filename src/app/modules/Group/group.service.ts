import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import {
  GroupPlanKey,
  normalizeGroupPlanKeys,
} from "../../../helpars/groupPlanKeys";

type CreateGroupPayload = {
  name?: string;
  description?: string | null;
  permissions?: string[];
  status?: "ACTIVE" | "INACTIVE";
};

const assertGroupExists = async (id: string) => {
  const group = await prisma.group.findUnique({ where: { id } });
  if (!group) {
    throw new ApiError(httpStatus.NOT_FOUND, "Group not found");
  }
  return group;
};

const validateName = (name: unknown): string => {
  if (typeof name !== "string" || !name.trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Group name is required");
  }
  return name.trim();
};

const validatePlanAccess = (permissions: unknown): GroupPlanKey[] => {
  const keys = normalizeGroupPlanKeys(permissions);
  if (keys.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Select at least one plan: PLUS, PRO, or ULTRA",
    );
  }

  if (Array.isArray(permissions)) {
    const invalid = permissions.filter(
      (p) =>
        typeof p === "string" &&
        p.trim() &&
        !normalizeGroupPlanKeys([p]).length,
    );
    if (invalid.length) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Invalid plan identifier(s): ${invalid.join(", ")}. Use PLUS, PRO, or ULTRA.`,
      );
    }
  }

  return keys;
};

const ensureUniqueName = async (name: string, excludeId?: string) => {
  const existing = await prisma.group.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });
  if (existing) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "A group with this name already exists",
    );
  }
};

const syncMemberCount = async (groupId: string) => {
  const count = await prisma.groupUser.count({ where: { groupId } });
  await prisma.group.update({
    where: { id: groupId },
    data: { totalMembers: count },
  });
  return count;
};

const createGroup = async (
  payload: CreateGroupPayload,
  createdBy?: string,
) => {
  const name = validateName(payload.name);
  const permissions = validatePlanAccess(payload.permissions);
  await ensureUniqueName(name);

  const description =
    typeof payload.description === "string"
      ? payload.description.trim() || null
      : payload.description ?? null;

  return prisma.group.create({
    data: {
      name,
      description,
      permissions,
      status: payload.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      createdBy: createdBy || null,
      totalMembers: 0,
    },
  });
};

const getAllGroups = async (query: Record<string, unknown>) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  const skip = (page - 1) * limit;
  const search = typeof query.search === "string" ? query.search : undefined;
  const status = typeof query.status === "string" ? query.status : undefined;

  const andConditions: Record<string, unknown>[] = [];

  if (search) {
    andConditions.push({
      name: { contains: search, mode: "insensitive" },
    });
  }

  if (status) {
    andConditions.push({ status });
  }

  const whereConditions = andConditions.length ? { AND: andConditions } : {};

  const [groups, total] = await Promise.all([
    prisma.group.findMany({
      where: whereConditions,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { groupUsers: true } },
      },
    }),
    prisma.group.count({ where: whereConditions }),
  ]);

  const result = groups.map((group) => ({
    ...group,
    memberCount: group._count.groupUsers,
    planAccess: group.permissions,
  }));

  return {
    meta: {
      total,
      page,
      limit,
      totalPage: Math.ceil(total / limit),
    },
    data: result,
  };
};

const getSingleGroup = async (id: string) => {
  const group = await prisma.group.findUnique({
    where: { id },
    include: {
      groupUsers: {
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              status: true,
              currentPlan: true,
              role: true,
            },
          },
        },
      },
      _count: { select: { groupUsers: true } },
    },
  });

  if (!group) {
    throw new ApiError(httpStatus.NOT_FOUND, "Group not found");
  }

  const members = group.groupUsers.map((gu) => ({
    id: gu.id,
    userId: gu.userId,
    dateAdded: gu.createdAt,
    user: gu.user,
  }));

  return {
    ...group,
    memberCount: group._count.groupUsers,
    planAccess: group.permissions,
    members,
  };
};

const updateGroup = async (id: string, payload: CreateGroupPayload) => {
  await assertGroupExists(id);

  const data: {
    name?: string;
    description?: string | null;
    permissions?: GroupPlanKey[];
    status?: "ACTIVE" | "INACTIVE";
  } = {};

  if (payload.name !== undefined) {
    data.name = validateName(payload.name);
    await ensureUniqueName(data.name, id);
  }

  if (payload.description !== undefined) {
    data.description =
      typeof payload.description === "string"
        ? payload.description.trim() || null
        : payload.description;
  }

  if (payload.permissions !== undefined) {
    data.permissions = validatePlanAccess(payload.permissions);
  }

  if (payload.status === "ACTIVE" || payload.status === "INACTIVE") {
    data.status = payload.status;
  }

  if (Object.keys(data).length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No valid fields to update");
  }

  return prisma.group.update({
    where: { id },
    data,
  });
};

/**
 * Deletes the group and memberships only.
 * Does NOT delete users, subscriptions, payments, or UserAccess rows.
 */
const deleteGroup = async (id: string) => {
  await assertGroupExists(id);

  await prisma.$transaction(async (tx) => {
    await tx.groupUser.deleteMany({ where: { groupId: id } });
    await tx.group.delete({ where: { id } });
  });

  return { id, deleted: true };
};

const addUsersToGroup = async (groupId: string, userIds: string[]) => {
  await assertGroupExists(groupId);

  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "At least one userId is required");
  }

  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));

  const users = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, status: true },
  });

  if (users.length !== uniqueIds.length) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "One or more users were not found",
    );
  }

  const blocked = users.filter((u) => u.status === "BLOCKED");
  if (blocked.length) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Cannot add blocked users to a group",
    );
  }

  const existing = await prisma.groupUser.findMany({
    where: { groupId, userId: { in: uniqueIds } },
    select: { userId: true },
  });
  const existingIds = new Set(existing.map((e) => e.userId));
  const toAdd = uniqueIds.filter((id) => !existingIds.has(id));

  if (toAdd.length > 0) {
    await prisma.groupUser.createMany({
      data: toAdd.map((userId) => ({ groupId, userId })),
    });
  }

  const memberCount = await syncMemberCount(groupId);

  return {
    message: "Users added to group",
    added: toAdd.length,
    skipped: uniqueIds.length - toAdd.length,
    memberCount,
  };
};

const removeUserFromGroup = async (groupId: string, userId: string) => {
  await assertGroupExists(groupId);

  const membership = await prisma.groupUser.findFirst({
    where: { groupId, userId },
  });

  if (!membership) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "User is not a member of this group",
    );
  }

  await prisma.groupUser.delete({ where: { id: membership.id } });
  const memberCount = await syncMemberCount(groupId);

  return {
    message: "User removed from group",
    memberCount,
  };
};

export const GroupService = {
  createGroup,
  getAllGroups,
  getSingleGroup,
  updateGroup,
  deleteGroup,
  addUsersToGroup,
  removeUserFromGroup,
};
