import httpStatus from "http-status";

import { GroupService } from "./group.service";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";

const createGroup = catchAsync(async (req, res) => {
  const result = await GroupService.createGroup(req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Group created successfully",
    data: result,
  });
});

const getAllGroups = catchAsync(async (req, res) => {
  const result = await GroupService.getAllGroups(req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Groups retrieved successfully",
    data: result,
  });
});

const getSingleGroup = catchAsync(async (req, res) => {
  const { id } = req.params;

  const result = await GroupService.getSingleGroup(id);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Group retrieved successfully",
    data: result,
  });
});

const updateGroup = catchAsync(async (req, res) => {
  const { id } = req.params;

  const result = await GroupService.updateGroup(id, req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Group updated successfully",
    data: result,
  });
});

const deleteGroup = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await GroupService.deleteGroup(id);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Group deleted successfully",
    data: result,
  });
});

const addUsersToGroup = catchAsync(async (req, res) => {
  const { groupId, userIds } = req.body;

  const result = await GroupService.addUsersToGroup(groupId, userIds);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Users added to group successfully",
    data: result,
  });
});

export const GroupController = {
  createGroup,
  getAllGroups,
  getSingleGroup,
  updateGroup,
  deleteGroup,
  addUsersToGroup,
};
