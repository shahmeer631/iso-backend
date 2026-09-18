import prisma from "../../../shared/prisma";

const createAffiliate = async (payload: any) => {
  const result = await prisma.affiliate.create({
    data: {
      name: payload.name,
      email: payload.email,
      affiliateCode: payload.affiliateCode,
      commissionRate: Number(payload.commissionRate) || 0,

      status: payload.status || "ACTIVE",

      paymentMethod: payload.paymentMethod || null,
      paymentDetails: payload.paymentDetails || null,
      notes: payload.notes || null,

      totalSales: 0,
      totalRevenue: 0,
      totalCommission: 0,
    },
  });

  return result;
};

const getAffiliates = async (query: any) => {
  const { search, status, page = 1, limit = 10 } = query;

  const pageNumber = Number(page) || 1;
  const limitNumber = Number(limit) || 10;
  const skip = (pageNumber - 1) * limitNumber;

  const where: any = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { affiliateCode: { contains: search, mode: "insensitive" } },
    ];
  }

  if (status) {
    where.status = status;
  }

  const result = await prisma.affiliate.findMany({
    where,
    skip,
    take: limitNumber,
    orderBy: { createdAt: "desc" },
  });

  const total = await prisma.affiliate.count({ where });

  return {
    meta: {
      page: pageNumber,
      limit: limitNumber,
      total,
    },
    data: result,
  };
};

const updateAffiliate = async (id: string, payload: any) => {
  const data: any = {};

  if (payload.name) data.name = payload.name;
  if (payload.email) data.email = payload.email;
  if (payload.affiliateCode) data.affiliateCode = payload.affiliateCode;

  if (payload.commissionRate !== undefined) {
    data.commissionRate = Number(payload.commissionRate);
  }

  if (payload.status) data.status = payload.status;

  if (payload.paymentMethod !== undefined) {
    data.paymentMethod = payload.paymentMethod;
  }

  if (payload.paymentDetails !== undefined) {
    data.paymentDetails = payload.paymentDetails;
  }

  if (payload.notes !== undefined) {
    data.notes = payload.notes;
  }

  const result = await prisma.affiliate.update({
    where: { id },
    data,
  });

  return result;
};

const deleteAffiliate = async (id: string) => {
  return prisma.affiliate.delete({
    where: { id },
  });
};

const getAffiliateStats = async () => {
  // total affiliates
  const totalAffiliates = await prisma.affiliate.count();

  // total revenue + commission
  const aggregates = await prisma.affiliate.aggregate({
    _sum: {
      totalRevenue: true,
      totalCommission: true,
      totalSales: true,
    },
  });

  // current month filter
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const salesThisMonth = await prisma.affiliate.aggregate({
    _sum: {
      totalSales: true,
    },
    where: {
      updatedAt: {
        gte: startOfMonth,
      },
    },
  });

  return {
    totalAffiliates,
    totalRevenue: aggregates._sum.totalRevenue || 0,
    totalCommission: aggregates._sum.totalCommission || 0,
    totalSales: aggregates._sum.totalSales || 0,
    totalSalesThisMonth: salesThisMonth._sum.totalSales || 0,
  };
};

export const AffiliateService = {
  createAffiliate,
  getAffiliates,
  updateAffiliate,
  deleteAffiliate,
  getAffiliateStats
};
