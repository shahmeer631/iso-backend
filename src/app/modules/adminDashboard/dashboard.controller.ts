import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { DashboardService } from "./dashboard.service";
import httpStatus from "http-status";

const getDashboardStats = catchAsync(async (req, res) => {
  const result = await DashboardService.getDashboardStats();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Dashboard stats retrieved",
    data: result,
  });
});

const getAllTransactions = catchAsync(async (req, res) => {
  const result = await DashboardService.getAllTransactions(req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Transactions retrieved successfully",
    data: result,
  });
});

const getOrders = catchAsync(async (req, res) => {
  const result = await DashboardService.getOrders(req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Orders retrieved successfully",
    data: result,
  });
});

const getUsageUnits = catchAsync(async (req, res) => {
  const result = await DashboardService.getUsageUnits();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Usage units retrieved",
    data: result,
  });
});

const getAnalytics = catchAsync(async (req, res) => {
  const result = await DashboardService.getAnalytics();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Analytics retrieved",
    data: result,
  });
});

const getReveneueReport = catchAsync(async (req, res) => {
  const result = await DashboardService.getRevenueReport();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Revenue report retrieved",
    data: result,
  });
});

const adminEnrollUsers = catchAsync(async (req, res) => {
  const { courseId, userIds } = req.body;
  const result = await DashboardService.adminEnrollUsers(userIds, courseId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Users enrolled successfully (admin)",
    data: result,
  });
});

const adminUnenrollUsers = catchAsync(async (req, res) => {
  const { courseId, userIds } = req.body;
  const result = await DashboardService.adminUnenrollUsers(userIds, courseId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Users unenrolled successfully",
    data: result,
  });
});

export const DashboardController = {
  getDashboardStats,
  getAllTransactions,
  getOrders,
  getUsageUnits,
  getAnalytics,
  getReveneueReport,
  adminEnrollUsers,
  adminUnenrollUsers,
};
