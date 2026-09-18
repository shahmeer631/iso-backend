import httpStatus from "http-status";
import { CommunityService } from "./community.service";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";

const createCommunity = catchAsync(async (req, res) => {
  const result = await CommunityService.createCommunity(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Community created successfully",
    data: result,
  });
});

const getCommunities = catchAsync(async (req, res) => {
  const result = await CommunityService.getCommunities(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Communities retrieved successfully",
    data: result,
  });
});

const getSingleCommunity = catchAsync(async (req, res) => {
  const { id } = req.params;

  const result = await CommunityService.getSingleCommunity(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Community retrieved successfully",
    data: result,
  });
});

const updateCommunity = catchAsync(async (req, res) => {
  const { id } = req.params;

  const result = await CommunityService.updateCommunity(id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Community updated successfully",
    data: result,
  });
});

const deleteCommunity = catchAsync(async (req, res) => {
  const { id } = req.params;

  const result = await CommunityService.deleteCommunity(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Community deleted successfully",
    data: result,
  });
});

export const CommunityController = {
  createCommunity,
  getCommunities,
  getSingleCommunity,
  updateCommunity,
  deleteCommunity,
};
