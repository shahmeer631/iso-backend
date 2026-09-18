import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { AIAssistantService } from "./aiassistant.service";
import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";

const generateISO = catchAsync(async (req, res) => {
  const userId = req.user?.id;


  const result = await AIAssistantService.generateISO(req.body);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "ISO generated successfully",
    data: result,
  });
});

const simpleChat = catchAsync(async (req, res) => {
  const result = await AIAssistantService.simpleChat(req.body);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Chat response",
    data: result,
  });
});

const chat = catchAsync(async (req, res) => {
  const userId = req.user?.id;

  const payload = {
    ...req.body,
    file: req.file,
  };

  const result = await AIAssistantService.chat(userId, payload);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Chat response",
    data: result,
  });
});

const generateFlashcards = catchAsync(async (req, res) => {
  const userId = req.user?.id;

  const payload = {
    ...req.body,
    file: req.file,
  };

  const result = await AIAssistantService.generateFlashcards(userId, payload);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Flashcards generated successfully",
    data: result,
  });
});

const getChatSessions = catchAsync(async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized");
  }

  const result = await AIAssistantService.getChatSessions(userId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Chat sessions fetched successfully",
    data: result,
  });
});

const getChatHistory = catchAsync(async (req, res) => {
  const userId = req.user?.id;
  const { sessionId } = req.params;

  if (!userId) {
    throw new ApiError(401, "Unauthorized");
  }

  // 🔥 OPTIONAL SECURITY (recommended)
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.userId !== userId) {
    throw new ApiError(403, "Forbidden");
  }

  const result = await AIAssistantService.getChatHistory(sessionId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Chat history fetched successfully",
    data: result,
  });
});

const getSessionsByISO = catchAsync(async (req, res) => {
  const userId = req.user?.id;
  const { isoStandardId } = req.params;

  const result = await AIAssistantService.getSessionsByISO(
    userId,
    isoStandardId,
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "ISO based sessions fetched",
    data: result,
  });
});

// 🔥 AUDIT CONTEXT
const getAuditContext = catchAsync(async (req, res) => {
  const userId = req.user?.id;


  const result = await AIAssistantService.getAuditContext(req.body);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Audit context generated successfully",
    data: result,
  });
});

// 🔥 AUDIT STEP
const getAuditStep = catchAsync(async (req, res) => {
  const userId = req.user?.id;


  const result = await AIAssistantService.getAuditStep(req.body);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Audit step generated successfully",
    data: result,
  });
});

const analyzeBenchmarkFile = catchAsync(async (req, res) => {
  const userId = req.user?.id;


  const result = await AIAssistantService.analyzeBenchmarkFile(
    req.file,
    req.body,
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "File analyzed",
    data: result,
  });
});

const analyzeBenchmarkText = catchAsync(async (req, res) => {
  const userId = req.user?.id;


  const result = await AIAssistantService.analyzeBenchmarkText(req.body);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Text analyzed",
    data: result,
  });
});

// 🔥 CONTEXT GENERATOR
const generateContext = catchAsync(async (req, res) => {
  const userId = req.user?.id;


  const result = await AIAssistantService.generateContext(req.body);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Context generated successfully",
    data: result,
  });
});

// 🔥 ISO SUGGESTIONS
const getISOSuggestions = catchAsync(async (req, res) => {
  const userId = req.user?.id;


  const result = await AIAssistantService.getISOSuggestions(req.body);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "ISO suggestions fetched successfully",
    data: result,
  });
});

const getBenchmarkAISuggestions = catchAsync(async (req, res) => {
  const result = await AIAssistantService.getBenchmarkAISuggestions(
    req.body,
    req.file,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "ISO suggestions fetched successfully",
    data: result,
  });
});

const generateFollowup = catchAsync(async (req, res) => {
  const result = await AIAssistantService.generateFollowup(req.body);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Followup generated successfully",
    data: result,
  });
});

export const AIAssistantController = {
  generateISO,
  simpleChat,
  chat,
  generateFlashcards,
  getChatSessions,
  getChatHistory,
  getSessionsByISO,
  getAuditContext,
  getAuditStep,
  analyzeBenchmarkFile,
  analyzeBenchmarkText,
  generateContext,
  getISOSuggestions,
  getBenchmarkAISuggestions,
  generateFollowup,
};
