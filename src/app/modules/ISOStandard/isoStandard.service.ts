import prisma from "../../../shared/prisma";
import axios from "axios";
import FormData from "form-data";

/** AI_BASE_URL already includes /api/v1 — do not append another /api/v1. */
async function ingestIsoStandardToAI(params: {
  id: string;
  title: string;
  fileUrl: string;
}) {
  const fileRes = await axios.get(params.fileUrl, {
    responseType: "arraybuffer",
    timeout: 60000,
  });
  const fileName = params.fileUrl.split("/").pop() || "document.pdf";

  const formData = new FormData();
  formData.append("file", Buffer.from(fileRes.data), fileName);
  formData.append(
    "metadata",
    JSON.stringify({
      isoStandardId: params.id,
      title: params.title,
      sourceType: "ISO_STANDARD",
    }),
  );

  await axios.post(`${process.env.AI_BASE_URL}/ingest`, formData, {
    headers: formData.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 120000,
  });
}

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

  // Ingest to remote AI knowledge index (best-effort; never block create)
  if (payload.fileUrl) {
    try {
      await ingestIsoStandardToAI({
        id: result.id,
        title: result.title,
        fileUrl: payload.fileUrl,
      });
      console.log(
        `[ISOIngest] ok id=${result.id} title=${JSON.stringify(result.title)}`,
      );
    } catch (error: any) {
      console.error(
        `[ISOIngest] failed id=${result.id} status=${error?.response?.status || "n/a"} message=${error?.message || error}`,
      );
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

  const previous = await prisma.iSOStandard.findUnique({
    where: { id },
    select: { fileUrl: true, title: true },
  });

  const result = await prisma.iSOStandard.update({
    where: { id },
    data,
    include: {
      category: true,
    },
  });

  // Re-ingest when file changes so remote RAG stays aligned with the locked edition PDF
  const fileChanged =
    typeof payload.fileUrl === "string" &&
    payload.fileUrl &&
    payload.fileUrl !== previous?.fileUrl;

  if (fileChanged) {
    try {
      await ingestIsoStandardToAI({
        id: result.id,
        title: result.title,
        fileUrl: result.fileUrl,
      });
      console.log(`[ISOIngest] update-ok id=${result.id}`);
    } catch (error: any) {
      console.error(
        `[ISOIngest] update-failed id=${result.id} status=${error?.response?.status || "n/a"} message=${error?.message || error}`,
      );
    }
  }

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
