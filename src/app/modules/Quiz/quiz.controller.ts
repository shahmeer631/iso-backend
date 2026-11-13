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

const resolveGuestId = (req: any): string | null => {
  const fromBody =
    typeof req.body?.guestId === "string" ? req.body.guestId.trim() : "";
  if (fromBody) return fromBody;

  const header = req.headers?.["x-guest-id"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === "string" && fromHeader.trim()) {
    return fromHeader.trim();
  }

  const fromCookie =
    typeof req.cookies?.guestId === "string" ? req.cookies.guestId.trim() : "";
  return fromCookie || null;
};

const generateQuizByUser = catchAsync(async (req, res) => {
  const userId = (req as any).user?.id || null;
  // Prefer authenticated identity; otherwise bind the exam session to a stable guest id
  const guestId = userId ? null : resolveGuestId(req);

  const result = await QuizService.generateQuiz({
    ...req.body,
    userId,
    guestId,
  });

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
