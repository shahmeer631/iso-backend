import httpStatus from "http-status";
import { LessonService } from "./lesson.service";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import ApiError from "../../../errors/ApiErrors";
import {
  applyAcademyLessonAccessToLessonList,
  assertCanAccessLessonContent,
  canAccessLessonContent,
} from "../../../helpars/academyLessonAccess";

const createLesson = catchAsync(async (req, res) => {
  const result = await LessonService.createLesson(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Lesson created successfully",
    data: result,
  });
});

const getLessonsByCourse = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const userId = (req as any).user?.id as string | undefined;

  const result = await LessonService.getLessonsByCourse(courseId);
  const secured = await applyAcademyLessonAccessToLessonList(result, userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Lessons retrieved successfully",
    data: secured,
  });
});

const getAllLessons = catchAsync(async (req, res) => {
  const result = await LessonService.getAllLessons();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Lessons retrieved successfully",
    data: result,
  });
});

const getSingleLesson = catchAsync(async (req, res) => {
  const { id } = req.params;
  const userId = (req as any).user?.id as string | undefined;

  const result = await LessonService.getSingleLesson(id);
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, "Lesson not found");
  }

  await assertCanAccessLessonContent(userId, result.courseId, result.id);

  const decision = await canAccessLessonContent(
    userId,
    result.courseId,
    result.id,
  );

  const payload = {
    ...result,
    isLocked: false,
    isFreePreview: decision.isFreePreview,
    freeAccessRank: decision.rank,
  };

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Lesson retrieved successfully",
    data: payload,
  });
});

const updateLesson = catchAsync(async (req, res) => {
  const { id } = req.params;

  const result = await LessonService.updateLesson(id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Lesson updated successfully",
    data: result,
  });
});

const deleteLesson = catchAsync(async (req, res) => {
  const { id } = req.params;

  const result = await LessonService.deleteLesson(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Lesson deleted successfully",
    data: result,
  });
});

export const LessonController = {
  createLesson,
  getLessonsByCourse,
  getAllLessons,
  getSingleLesson,
  updateLesson,
  deleteLesson,
};
