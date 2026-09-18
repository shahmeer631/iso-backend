import httpStatus from "http-status";
import { CourseService } from "./course.service";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import ApiError from "../../../errors/ApiErrors";

const createCourse = catchAsync(async (req, res) => {
  const result = await CourseService.createCourse(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Course created successfully",
    data: result,
  });
});

const getCourses = catchAsync(async (req, res) => {
  const result = await CourseService.getCourses(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Courses retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getAllCoursesName = catchAsync(async (req, res) => {
  const result = await CourseService.getAllCoursesName();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Courses retrieved successfully",
    data: result,
  });
});

const getSingleCourse = catchAsync(async (req, res) => {
  const userId = req.user?.id;
  const role = req.user?.role;

  // 🔥 ADMIN BYPASS logic moved to middleware

  const result = await CourseService.getSingleCourse(req.params.id);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Course fetched successfully",
    data: result,
  });
});

const updateCourse = catchAsync(async (req, res) => {
  const { id } = req.params;

  const result = await CourseService.updateCourse(id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Course updated successfully",
    data: result,
  });
});

const deleteCourse = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await CourseService.deleteCourse(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Course deleted successfully",
    data: result,
  });
});

const completeCourse = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const courseId = req.params.courseId;

  // 🔥 FEATURE CHECK moved to middleware

  const result = await CourseService.completeCourse(userId, courseId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Course completed",
    data: result,
  });
});

export const CourseController = {
  createCourse,
  getCourses,
  getAllCoursesName,
  getSingleCourse,
  updateCourse,
  deleteCourse,
  completeCourse,
};
