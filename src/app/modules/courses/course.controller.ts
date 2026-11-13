import httpStatus from "http-status";
import { CourseService } from "./course.service";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import ApiError from "../../../errors/ApiErrors";
import { applyAcademyLessonAccessToCourse } from "../../../helpars/academyLessonAccess";

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
  const locale = String(
    req.query.locale || req.headers["x-locale"] || "en",
  );
  let data = result.data;
  if (locale && locale !== "en" && Array.isArray(data)) {
    const { localizeCourseRecord } = await import(
      "../../../helpars/contentLocalization"
    );
    data = await Promise.all(
      data.map((course: any) => localizeCourseRecord(course, locale)),
    );
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Courses retrieved successfully",
    meta: result.meta,
    data,
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
  const userId = (req as any).user?.id as string | undefined;

  const result = await CourseService.getSingleCourse(req.params.id);
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, "Course not found");
  }

  const secured = await applyAcademyLessonAccessToCourse(result, userId);
  const locale = String(
    req.query.locale || req.headers["x-locale"] || "en",
  );
  let data: any = secured;
  if (locale && locale !== "en") {
    const {
      localizeCourseRecord,
      localizeLessonRecord,
    } = await import("../../../helpars/contentLocalization");
    data = await localizeCourseRecord(secured as any, locale);
    if (Array.isArray(data?.lessons)) {
      data.lessons = await Promise.all(
        data.lessons.map((lesson: any) =>
          localizeLessonRecord(lesson, locale),
        ),
      );
    }
  }

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Course fetched successfully",
    data,
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
