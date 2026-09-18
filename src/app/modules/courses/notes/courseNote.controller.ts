import catchAsync from "../../../../shared/catchAsync";
import sendResponse from "../../../../shared/sendResponse";
import { CourseNoteService } from "./courseNote.service";
import httpStatus from "http-status";

const createCourseNote = catchAsync(async (req, res) => {
  const result = await CourseNoteService.createCourseNote({
    ...req.body,
    userId: req.user.id,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Course note created successfully",
    data: result,
  });
});

const getAllNotes = catchAsync(async (req, res) => {
  const result = await CourseNoteService.getAllNotes(req.user.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "All course notes retrieved successfully",
    data: result,
  });
});

const getCourseNotes = catchAsync(async (req, res) => {
  const { courseId } = req.params;

  const result = await CourseNoteService.getCourseNotes(req.user.id, courseId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Course notes retrieved successfully",
    data: result,
  });
});

const getSingleCourseNote = catchAsync(async (req, res) => {
  const { id } = req.params;

  const result = await CourseNoteService.getSingleCourseNote(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Course note retrieved successfully",
    data: result,
  });
});

const updateCourseNote = catchAsync(async (req, res) => {
  const { id } = req.params;

  const result = await CourseNoteService.updateCourseNote(id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Course note updated successfully",
    data: result,
  });
});

const deleteCourseNote = catchAsync(async (req, res) => {
  const { id } = req.params;

  const result = await CourseNoteService.deleteCourseNote(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Course note deleted successfully",
    data: result,
  });
});

export const CourseNoteController = {
  createCourseNote,
  getAllNotes,
  getCourseNotes,
  getSingleCourseNote,
  updateCourseNote,
  deleteCourseNote,
};
