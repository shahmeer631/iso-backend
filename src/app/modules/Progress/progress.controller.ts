import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { ProgressServices } from "./progress.service";
import httpStatus from "http-status";

const markLessonComplete = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { lessonId, passed } = req.body;

  const result = await ProgressServices.markLessonComplete(
    userId,
    lessonId,
    passed,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Lesson completed successfully",
    data: result,
  });
});

const getCourseWithProgress = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { courseId } = req.params;

  const result = await ProgressServices.getCourseWithProgress(userId, courseId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Course progress retrieved successfully",
    data: result,
  });
});

export const ProgressController = {
  markLessonComplete,
  getCourseWithProgress,
};
