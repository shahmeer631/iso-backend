import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import httpStatus from "http-status";
import { UserDashboardServices } from "./dashboard.service";

const enroll = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { courseId } = req.body;

  const result = await UserDashboardServices.enrollCourse(userId, courseId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Enrolled successfully",
    data: result,
  });
});

const getMyCoursesController = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const result = await UserDashboardServices.getMyCourses(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "My courses fetched successfully",
    data: result,
  });
});

const getUserDashboard = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const result = await UserDashboardServices.getUserDashboard(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User dashboard fetched successfully",
    data: result,
  });
});

const getMyProgress = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const result = await UserDashboardServices.getMyProgress(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "My progress fetched successfully",
    data: result,
  });
});

const getMyCertificates = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const result = await UserDashboardServices.getMyCertificates(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "My certificates fetched successfully",
    data: result,
  });
});

const getUserBillingOverview = catchAsync(async (req, res) => {
  const userId = req.user.id; // 🔥 from auth

  const result = await UserDashboardServices.getUserBillingOverview(userId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Billing overview fetched successfully",
    data: result,
  });
});

export const UserDashboardController = {
  enroll,
  getMyCoursesController,
  getUserDashboard,
  getMyProgress,
  getMyCertificates,
  getUserBillingOverview,
};
