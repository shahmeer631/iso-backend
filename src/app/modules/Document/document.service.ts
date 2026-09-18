import prisma from "../../../shared/prisma";

const createDocument = async (payload: any) => {
  const result = await prisma.document.create({
    data: payload,
    include: {
      category: true,
    },
  });

  return result;
};


const createDocuments = async (payloads: any[]) => {
  return await Promise.all(
    payloads.map((payload) =>
      prisma.document.create({
        data: payload,
        include: {
          category: true,
        },
      })
    )
  );
};

const getDocuments = async (query: any) => {
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

  const whereConditions = andConditions.length
    ? { AND: andConditions }
    : {};

  const result = await prisma.document.findMany({
    where: whereConditions,
    include: {
      category: true,
    },
    skip,
    take: Number(limit),
    orderBy: {
      createdAt: "desc",
    },
  });

  const total = await prisma.document.count({
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

const getSingleDocument = async (id: string) => {
  const result = await prisma.document.findUnique({
    where: { id },
    include: {
      category: true,
    },
  });

  return result;
};

const updateDocument = async (id: string, payload: any) => {
  const result = await prisma.document.update({
    where: { id },
    data: payload,
    include: {
      category: true,
    },
  });

  return result;
};

const deleteDocument = async (id: string) => {
  const result = await prisma.document.delete({
    where: { id },
  });

  return result;
};

export const DocumentService = {
  createDocument,
  createDocuments,
  getDocuments,
  getSingleDocument,
  updateDocument,
  deleteDocument,
};