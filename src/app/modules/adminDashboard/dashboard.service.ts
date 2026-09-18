import prisma from "../../../shared/prisma";

const getDashboardStats = async () => {
  // 🔥 1. TOTAL REVENUE
  const totalRevenue = await prisma.payment.aggregate({
    _sum: { finalAmount: true },
    where: { status: "SUCCEEDED" },
  });

  // 🔥 2. TOTAL USERS
  const totalUsers = await prisma.user.count();

  // 🔥 3. ACTIVE COURSES
  const activeCourses = await prisma.course.count({
    where: { status: "PUBLISHED" },
  });

  // 🔥 4. RECENT ORDERS (IMPORTANT)
  const recentOrders = await prisma.payment.findMany({
    where: { status: "SUCCEEDED" },
    orderBy: { createdAt: "desc" },
    take: 5, // last 5 orders
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      plan: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return {
    stats: {
      totalRevenue: totalRevenue._sum.finalAmount || 0,
      totalUsers,
      activeCourses,
      newLeads: 0, // later
    },
    recentOrders,
  };
};

const getAllTransactions = async (query: any) => {
  const { page = 1, limit = 10, search, status } = query;

  const skip = (Number(page) - 1) * Number(limit);

  const where: any = {};

  // 🔍 Search (email or name)
  if (search) {
    where.OR = [
      {
        user: {
          email: { contains: search, mode: "insensitive" },
        },
      },
      {
        user: {
          firstName: { contains: search, mode: "insensitive" },
        },
      },
    ];
  }

  // 📊 Status filter
  if (status && status !== "ALL") {
    where.status = status; // SUCCEEDED | PENDING | FAILED
  }

  // 🔥 DATA
  const data = await prisma.payment.findMany({
    where,
    skip,
    take: Number(limit),
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      plan: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const total = await prisma.payment.count({ where });

  // 🔥 STATS (TOP CARDS)
  const stats = await prisma.payment.groupBy({
    by: ["status"],
    _count: { _all: true },
    _sum: { finalAmount: true },
  });

  let totalRevenue = 0;
  let completed = 0;
  let pending = 0;
  let failed = 0;

  stats.forEach((item) => {
    if (item.status === "SUCCEEDED") {
      totalRevenue = item._sum.finalAmount || 0;
      completed = item._count._all;
    }
    if (item.status === "PENDING") {
      pending = item._count._all;
    }
    if (item.status === "FAILED") {
      failed = item._count._all;
    }
  });

  return {
    meta: {
      page: Number(page),
      limit: Number(limit),
      total,
    },
    stats: {
      totalRevenue,
      completed,
      pending,
      failed,
    },
    data,
  };
};

const getOrders = async (query: any) => {
  // const { page = 1, limit = 10, search, status } = query;
  // const skip = (Number(page) - 1) * Number(limit);
  // const where: any = {};

  // 🔍 Search
  // if (search) {
  //   where.OR = [
  //     {
  //       user: {
  //         email: { contains: search, mode: "insensitive" },
  //       },
  //     },
  //     {
  //       user: {
  //         firstName: { contains: search, mode: "insensitive" },
  //       },
  //     },
  //   ];
  // }

  // 📊 Status filter
  // if (status && status !== "ALL") {
  //   where.status = status;
  // }

  // 🔥 Orders data (from payments)
  const data = await prisma.payment.findMany({
    // where,
    // skip,
    // take: Number(limit),
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      plan: {
        select: {
          name: true,
        },
      },
    },
  });

  // const total = await prisma.payment.count({ where });

  // 🔥 STATS

  // 👉 Today revenue
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayRevenue = await prisma.payment.aggregate({
    _sum: { finalAmount: true },
    where: {
      status: "SUCCEEDED",
      createdAt: { gte: todayStart },
    },
  });

  // 👉 Total orders
  const totalOrders = await prisma.payment.count();

  // 👉 Avg order value
  const avg = await prisma.payment.aggregate({
    _avg: { finalAmount: true },
    where: { status: "SUCCEEDED" },
  });

  // 👉 Pending
  const pendingOrders = await prisma.payment.count({
    where: { status: "PENDING" },
  });

  return {
    // meta: {
    //   page: Number(page),
    //   limit: Number(limit),
    //   total,
    // },
    stats: {
      todayRevenue: todayRevenue._sum.finalAmount || 0,
      totalOrders,
      avgOrderValue: avg._avg.finalAmount || 0,
      pendingOrders,
    },
    data,
  };
};

const getUsageUnits = async () => {
  const accesses = await prisma.userAccess.findMany({
    where: { isActive: true },
    include: { plan: true },
  });

  const activeSubscribers = accesses.length;

  const planMap: any = {};

  accesses.forEach((item) => {
    const planId = item.planId;

    if (!planMap[planId]) {
      planMap[planId] = {
        planName: item.plan.name,
        users: 0,
      };
    }

    planMap[planId].users += 1;
  });

  const plans = Object.values(planMap);

  return {
    stats: {
      activeSubscribers,
    },
    plans,
  };
};


const getAnalytics = async () => {
  // 🔥 1. STATS
  const totalUsers = await prisma.user.count();

  const activeCourses = await prisma.course.count({
    where: { status: "PUBLISHED" },
  });

  const revenue = await prisma.payment.aggregate({
    _sum: { finalAmount: true },
    where: { status: "SUCCEEDED" },
  });

  // fake engagement (you can improve later)
  const engagementRate = 68;

  // 🔥 2. USER ACTIVITY (last 7 days grouped)
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const userActivity: any[] = [];

  for (let i = 0; i < 7; i++) {
    const day = new Date();
    day.setDate(day.getDate() - i);

    const start = new Date(day);
    start.setHours(0, 0, 0, 0);

    const end = new Date(day);
    end.setHours(23, 59, 59, 999);

    const count = await prisma.user.count({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
      },
    });

    userActivity.push({
      day: days[day.getDay()],
      users: count,
    });
  }

  // 🔥 3. POPULAR COURSES (FIXED: Count Unique Active Users per Plan)
  const popularCourses = await prisma.user.groupBy({
    by: ["planId"],
    where: {
      planId: { not: null },
      subscribed: "SUBSCRIBED" // only currently active subscribers
    },
    _count: { _all: true },
    orderBy: { _count: { planId: "desc" } },
    take: 4,
  });

  const courses = await Promise.all(
    popularCourses.map(async (item) => {
      const plan = await prisma.plan.findUnique({
        where: { id: item.planId as string },
      });

      return {
        name: plan?.name,
        students: item._count._all,
        rating: 4.5, // mock for now
      };
    }),
  );

  // 🔥 4. TRAFFIC SOURCES (mock for now)
  const trafficSources = [
    { name: "Direct", value: 45 },
    { name: "Search Engines", value: 32 },
    { name: "Social Media", value: 16 },
    { name: "Referrals", value: 7 },
  ];

  return {
    stats: {
      totalUsers,
      activeCourses,
      revenue: revenue._sum.finalAmount || 0,
      engagementRate,
    },
    userActivity: userActivity.reverse(),
    popularCourses: courses,
    trafficSources,
  };
};

const getRevenueReport = async () => {
  const payments = await prisma.payment.findMany({
    where: {
      status: "SUCCEEDED",
    },
    include: {
      plan: true,
    },
  });

  // =========================
  // 1. TOTAL REVENUE
  // =========================
  const totalRevenue = payments.reduce((sum, p) => sum + p.finalAmount, 0);

  // =========================
  // 2. AVG ORDER VALUE
  // =========================
  const avgOrderValue =
    payments.length > 0 ? totalRevenue / payments.length : 0;

  // =========================
  // 3. NET PROFIT (simple version)
  // =========================
  const netProfit = totalRevenue * 0.7; // you can adjust later

  // =========================
  // 4. REVENUE BY PLAN (IMPORTANT 🔥)
  // =========================
  const planMap: Record<string, number> = {};

  payments.forEach((p) => {
    const name = p.plan.name;

    if (!planMap[name]) {
      planMap[name] = 0;
    }

    planMap[name] += p.finalAmount;
  });

  const revenueByPlan = Object.entries(planMap).map(([name, revenue]) => ({
    name,
    revenue,
  }));

  // =========================
  // 5. TOP SELLING PLANS
  // =========================
  const topPlans = Object.entries(planMap)
    .map(([name, revenue]) => ({
      name,
      revenue,
      sales: payments.filter((p) => p.plan.name === name).length,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // =========================
  // 6. MONTHLY GROWTH
  // =========================
  const monthlyMap: Record<string, number> = {};

  payments.forEach((p) => {
    const date = new Date(p.createdAt);
    const month = date.toLocaleString("default", { month: "long" });

    if (!monthlyMap[month]) {
      monthlyMap[month] = 0;
    }

    monthlyMap[month] += p.finalAmount;
  });

  const monthlyGrowth = Object.entries(monthlyMap).map(([month, revenue]) => ({
    month,
    revenue,
  }));

  return {
    summary: {
      totalRevenue,
      netProfit,
      avgOrderValue,
    },
    revenueByPlan,
    topPlans,
    monthlyGrowth,
  };
};

const adminEnrollUsers = async (userIds: string[], courseId: string) => {
  const existing = await prisma.enrollment.findMany({
    where: {
      courseId,
      userId: { in: userIds },
    },
    select: { userId: true },
  });

  const existingIds = existing.map((e) => e.userId);
  const newUsers = userIds.filter((id) => !existingIds.includes(id));

  const data = newUsers.map((userId) => ({
    userId,
    courseId,
  }));

  if (data.length > 0) {
    await prisma.$transaction([
      prisma.enrollment.createMany({
        data,
      }),

      // 🔥 increment enrollmentCount
      prisma.user.updateMany({
        where: {
          id: { in: newUsers },
        },
        data: {
          enrollmentsCount: {
            increment: 1,
          },
        },
      }),
    ]);
  }

  return { message: "Users enrolled successfully (admin)" };
};

const adminUnenrollUsers = async (userIds: string[], courseId: string) => {
  // 🔥 first find who actually enrolled
  const existing = await prisma.enrollment.findMany({
    where: {
      courseId,
      userId: { in: userIds },
    },
    select: { userId: true },
  });

  const existingIds = existing.map((e) => e.userId);

  if (existingIds.length > 0) {
    await prisma.$transaction([
      prisma.enrollment.deleteMany({
        where: {
          courseId,
          userId: { in: existingIds },
        },
      }),

      // 🔥 decrement only valid users
      prisma.user.updateMany({
        where: {
          id: { in: existingIds },
        },
        data: {
          enrollmentsCount: {
            decrement: 1,
          },
        },
      }),
    ]);
  }

  return { message: "Users unenrolled successfully" };
};

export const DashboardService = {
  getDashboardStats,
  getAllTransactions,
  getOrders,
  getUsageUnits,
  getAnalytics,
  getRevenueReport,
  adminEnrollUsers,
  adminUnenrollUsers,
};
