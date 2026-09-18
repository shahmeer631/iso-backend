import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import httpStatus from "http-status";
import { VideoServices } from "./video.service";

const createVideo = catchAsync(async (req, res) => {
  const result = await VideoServices.createVideo(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Video created successfully",
    data: result,
  });
});

const getVideos = catchAsync(async (req, res) => {
  const result = await VideoServices.getVideos(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Videos retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getSingleVideo = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await VideoServices.getSingleVideo(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Video retrieved successfully",
    data: result,
  });
});

const updateVideo = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await VideoServices.updateVideo(id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Video updated successfully",
    data: result,
  });
});

const deleteVideo = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await VideoServices.deleteVideo(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Video deleted successfully",
    data: result,
  });
});

export const VideoController = Object.freeze({
  createVideo,
  getVideos,
  getSingleVideo,
  updateVideo,
  deleteVideo,
});
