import httpStatus from "http-status";
import { LessonService } from "./lesson.service";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";

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

  const result = await LessonService.getLessonsByCourse(courseId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Lessons retrieved successfully",
    data: result,
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

  const result = await LessonService.getSingleLesson(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Lesson retrieved successfully",
    data: result,
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
