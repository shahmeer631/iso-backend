import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { userService } from "./user.services";
import { Request, Response } from "express";

const createUser = catchAsync(async (req: Request, res: Response) => {
  const { email } = req.body;

  const result = await userService.createUserIntoDb(email);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP sent to email. Please verify your email.",
    data: result,
  });
});

const getUsers = catchAsync(async (req, res) => {
  const result = await userService.getUsers(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Users retrieved successfully",
    // meta: result.meta,
    data: result.data,
  });
});

const getUserById = catchAsync(async (req, res) => {
  const result = await userService.getUserById(req.params.id);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "User retrieved successfully",
    data: result,
  });
});

const updateProfile = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const result = await userService.updateProfile(userId, req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Profile updated successfully",
    data: result,
  });
});

const updateUser = catchAsync(async (req, res) => {
  const result = await userService.updateUserIntoDb(req.params.id, req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "User updated successfully",
    data: result,
  });
});

const deleteUser = catchAsync(async (req, res) => {
  await userService.deleteUser(req.params.id);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "User deleted successfully",
    data: null,
  });
});

const getMyProfile = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const result = await userService.getMyProfile(userId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "User profile retrieved successfully",
    data: result,
  });
});

const bulkDeleteUsers = catchAsync(async (req, res) => {
  const userIds = req.body.userIds;
  const result = await userService.bulkDeleteUsers(userIds);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Users deleted successfully",
    data: result,
  });
});

export const userController = {
  createUser,
  getUserById,
  getUsers,
  updateProfile,
  updateUser,
  deleteUser,
  getMyProfile,
  bulkDeleteUsers,
};
