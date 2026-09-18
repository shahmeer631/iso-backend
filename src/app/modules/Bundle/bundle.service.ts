import prisma from "../../../shared/prisma";

// ================== CREATE ==================
const createBundle = async (payload: any) => {
  const { courseIds, ...bundleData } = payload;

  const items =
    courseIds?.map((courseId: string) => ({
      itemType: "COURSE",
      itemId: courseId,
    })) || [];

  const result = await prisma.bundle.create({
    data: {
      title: bundleData.title,
      description: bundleData.description,
      price: Number(bundleData.price),
      originalPrice: bundleData.originalPrice
        ? Number(bundleData.originalPrice)
        : null,

      bundleItems: {
        create: items,
      },
    },
    include: {
      bundleItems: true,
    },
  });

  return result;
};

// ================== GET ALL ==================
const getBundles = async (query: any) => {
  const { page = 1, limit = 10, search, status } = query;

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
    andConditions.push({
      status,
    });
  }

  const whereConditions = andConditions.length ? { AND: andConditions } : {};

  const bundles = await prisma.bundle.findMany({
    where: whereConditions,
    skip,
    take: Number(limit),
    orderBy: {
      createdAt: "desc",
    },
    include: {
      bundleItems: true,
    },
  });

  const total = await prisma.bundle.count({
    where: whereConditions,
  });

  // 🔥 attach courses manually
  const data = await Promise.all(
    bundles.map(async (bundle) => {
      const courseIds = bundle.bundleItems
        .filter((item) => item.itemType === "COURSE")
        .map((item) => item.itemId);

      const courses = await prisma.course.findMany({
        where: {
          id: { in: courseIds },
        },
      });

      return {
        ...bundle,
        courses,
      };
    }),
  );

  return {
    meta: {
      page: Number(page),
      limit: Number(limit),
      total,
    },
    data,
  };
};

// ================== GET SINGLE ==================
const getSingleBundle = async (id: string) => {
  const bundle = await prisma.bundle.findUnique({
    where: { id },
    include: {
      bundleItems: true,
    },
  });

  if (!bundle) return null;

  const courseIds = bundle.bundleItems
    .filter((item) => item.itemType === "COURSE")
    .map((item) => item.itemId);

  const courses = await prisma.course.findMany({
    where: { id: { in: courseIds } },
  });

  return {
    ...bundle,
    courses,
  };
};

// ================== UPDATE ==================
const updateBundle = async (id: string, payload: any) => {
  const { courseIds, ...rest } = payload;

  const data: any = {};

  if (rest.price !== undefined) {
    data.price = Number(rest.price);
  }

  if (rest.originalPrice !== undefined) {
    data.originalPrice = Number(rest.originalPrice);
  }

  if (rest.title !== undefined) data.title = rest.title;
  if (rest.description !== undefined) data.description = rest.description;

  // 🔥 ADD THIS
  if (rest.status !== undefined) {
    data.status = rest.status;
  }

  return prisma.$transaction(async (tx) => {
    // 🔥 update bundle info
    const updated = await tx.bundle.update({
      where: { id },
      data,
    });

    // 🔥 update bundle courses
    if (courseIds) {
      await tx.bundleItem.deleteMany({
        where: { bundleId: id },
      });

      await tx.bundleItem.createMany({
        data: courseIds.map((courseId: string) => ({
          bundleId: id,
          itemType: "COURSE",
          itemId: courseId,
        })),
      });
    }

    return updated;
  });
};

// ================== DELETE ==================
const deleteBundle = async (id: string) => {
  return prisma.$transaction(async (tx) => {
    // 🔥 delete all items first
    await tx.bundleItem.deleteMany({
      where: { bundleId: id },
    });

    // 🔥 delete bundle
    return tx.bundle.delete({
      where: { id },
    });
  });
};

export const BundleServices = {
  createBundle,
  getBundles,
  getSingleBundle,
  updateBundle,
  deleteBundle,
};
