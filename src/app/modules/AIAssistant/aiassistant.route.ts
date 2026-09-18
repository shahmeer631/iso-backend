import express from "express";
import { AIAssistantController } from "./aiassistant.controller";
import { fileUploader } from "../../../helpars/fileUploader";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";
import { apiUsage } from "../../../middlewares/apiUsage";
import { optionalAuth } from "../../../middlewares/optionalAuth";

const router = express.Router();

router.post(
  "/flashcards",
  optionalAuth(),
  apiUsage("AI_ASSISTANT"),
  fileUploader.upload.single("file"),
  AIAssistantController.generateFlashcards,
);

router.post(
  "/audit/context",
  optionalAuth(),
  apiUsage("AI_ASSISTANT"),
  AIAssistantController.getAuditContext,
);

router.post(
  "/audit/step",
  optionalAuth(),
  apiUsage("AI_ASSISTANT"),
  AIAssistantController.getAuditStep,
);

router.get(
  "/sessions",
  auth(UserRole.USER),
  AIAssistantController.getChatSessions,
);

router.get(
  "/sessions/:isoStandardId",
  auth(UserRole.USER),
  AIAssistantController.getSessionsByISO,
);

router.get(
  "/history/:sessionId",
  auth(UserRole.USER),
  AIAssistantController.getChatHistory,
);

router.post(
  "/context-generator",
  optionalAuth(),
  apiUsage("AI_ASSISTANT"),
  AIAssistantController.generateContext,
);

router.post(
  "/iso-suggestions",
  optionalAuth(),
  apiUsage("AI_ASSISTANT"),
  AIAssistantController.getISOSuggestions,
);

router.post(
  "/benchmark-ai/iso-suggestions",
  optionalAuth(),
  apiUsage("AI_ASSISTANT"),
  fileUploader.upload.single("file"),
  AIAssistantController.getBenchmarkAISuggestions,
);

router.post(
  "/navigator/generate",
  optionalAuth(),
  apiUsage("AI_ASSISTANT"),
  AIAssistantController.generateISO,
);

router.post(
  "/chat-simple",
  optionalAuth(),
  apiUsage("AI_ASSISTANT"),
  fileUploader.upload.none(),
  AIAssistantController.simpleChat,
);

router.post(
  "/chat",
  optionalAuth(),
  apiUsage("AI_ASSISTANT"),
  fileUploader.upload.single("file"),
  // auth(UserRole.USER),
  AIAssistantController.chat,
);

router.post(
  "/benchmark/analyze-file",
  optionalAuth(),
  apiUsage("AI_ASSISTANT"),
  fileUploader.upload.single("file"),
  AIAssistantController.analyzeBenchmarkFile,
);

router.post(
  "/benchmark/analyze-text",
  optionalAuth(),
  apiUsage("AI_ASSISTANT"),
  AIAssistantController.analyzeBenchmarkText,
);

router.post(
  "/quiz/followup",
  optionalAuth(),
  apiUsage("AI_ASSISTANT"),
  AIAssistantController.generateFollowup,
);

// ── LIBRARY ROUTES (LIBRARY feature — Plus plan and above) ──────────────
// These are the same as /chat and /flashcards but check for "LIBRARY" feature
// Used by: ISO Standards chat page (/library/iso-standards/chat/...)

router.post(
  "/library/chat",
  optionalAuth(),
  apiUsage("LIBRARY"),
  fileUploader.upload.single("file"),
  AIAssistantController.chat,
);

router.post(
  "/library/flashcards",
  optionalAuth(),
  apiUsage("LIBRARY"),
  fileUploader.upload.single("file"),
  AIAssistantController.generateFlashcards,
);

export const AIAssistantRoutes = router;
