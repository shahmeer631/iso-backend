import prisma from "../../../shared/prisma";
import axios from "axios";
import FormData from "form-data";

const createISOStandard = async (payload: any) => {
  const result = await prisma.iSOStandard.create({
    data: {
      // isoCode: payload.isoCode,
      title: payload.title,
      description: payload.description,
      // version: payload.version || null,
      categoryId: payload.categoryId,
      fileUrl: payload.fileUrl,
      fileSize: payload.fileSize ? Number(payload.fileSize) : null,
      status: payload.status || "ACTIVE",
    },
    include: {
      category: true,
    },
  });

  // 🔥 Ingest to AI endpoint
  if (payload.fileUrl) {
    try {
      const fileRes = await axios.get(payload.fileUrl, {
        responseType: "arraybuffer",
      });
      const fileName = payload.fileUrl.split("/").pop() || "document.pdf";

      const formData = new FormData();
      formData.append("file", fileRes.data, fileName);
      formData.append(
        "metadata",
        JSON.stringify({ isoStandardId: result.id, title: result.title }),
      );

      await axios.post(`${process.env.AI_BASE_URL}/api/v1/ingest`, formData, {
        headers: formData.getHeaders(),
        maxBodyLength: Infinity,
      });
    } catch (error) {
      console.error("Failed to ingest ISO standard to AI:", error);
    }
  }

  return result;
};

const getISOStandards = async (query: any) => {
  const { page = 1, limit = 10, search, categoryId, status } = query;

  const skip = (Number(page) - 1) * Number(limit);
  const andConditions: any[] = [];

  // 🔥 SEARCH ONLY BY TITLE
  if (search) {
    andConditions.push({
      title: {
        contains: search,
        mode: "insensitive",
      },
    });
  }

  if (categoryId) {
    andConditions.push({ categoryId });
  }

  if (status) {
    andConditions.push({ status });
  }

  const whereConditions =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const result = await prisma.iSOStandard.findMany({
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

  const total = await prisma.iSOStandard.count({
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

const getSingleISOStandard = async (id: string) => {
  const result = await prisma.iSOStandard.findUnique({
    where: { id },
    include: {
      category: true,
    },
  });

  return result;
};

const updateISOStandard = async (id: string, payload: any) => {
  const data: any = { ...payload };

  if (payload.fileSize) {
    data.fileSize = Number(payload.fileSize);
  }

  const result = await prisma.iSOStandard.update({
    where: { id },
    data,
    include: {
      category: true,
    },
  });

  return result;
};

const deleteISOStandard = async (id: string) => {
  const result = await prisma.iSOStandard.delete({
    where: { id },
  });

  return result;
};

const increaseDownload = async (id: string) => {
  const result = await prisma.iSOStandard.update({
    where: { id },
    data: {
      downloads: {
        increment: 1,
      },
    },
  });

  return result;
};

export const ISOStandardService = {
  createISOStandard,
  getISOStandards,
  getSingleISOStandard,
  updateISOStandard,
  deleteISOStandard,
  increaseDownload,
};
