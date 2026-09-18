import httpStatus from "http-status";
import { QuizService } from "./quiz.service";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";

const generateQuiz = catchAsync(async (req, res) => {
  const { lessonId, ...aiPayload } = req.body;
  const result = await QuizService.generateQuizAndSave(lessonId, aiPayload);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Quiz generated and saved successfully",
    data: result,
  });
});

const generateQuizByUser = catchAsync(async (req, res) => {
  const result = await QuizService.generateQuiz(req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Quiz generated successfully",
    data: result,
  });
});

export const QuizController = {
  generateQuiz,
  generateQuizByUser,
};
