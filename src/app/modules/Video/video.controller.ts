import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { VideoServices } from "./video.service";
import {
  ACADEMY_LESSON_LOCKED_CODE,
  canAccessVideoContent,
} from "../../../helpars/academyLessonAccess";

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
  const userId = (req as any).user?.id as string | undefined;
  const result = await VideoServices.getVideos(req.query);

  const data = [];
  for (const video of result.data || []) {
    const allowed = await canAccessVideoContent(userId, video.id);
    if (!allowed) {
      data.push({
        ...video,
        videoUrl: null,
        description: null,
        lessons: (video.lessons || []).map((lesson: any) => ({
          id: lesson.id,
          title: lesson.title,
          order: lesson.order,
          courseId: lesson.courseId,
          content: null,
          videoId: null,
          quizzes: [],
          isLocked: true,
        })),
        isLocked: true,
      });
      continue;
    }
    data.push(video);
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Videos retrieved successfully",
    meta: result.meta,
    data,
  });
});

const getSingleVideo = catchAsync(async (req, res) => {
  const { id } = req.params;
  const userId = (req as any).user?.id as string | undefined;

  const allowed = await canAccessVideoContent(userId, id);
  if (!allowed) {
    const err = new ApiError(
      httpStatus.FORBIDDEN,
      "Unlock this lesson with Premium access.",
    );
    (err as any).code = ACADEMY_LESSON_LOCKED_CODE;
    throw err;
  }

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
