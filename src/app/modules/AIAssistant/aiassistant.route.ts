import express from "express";
import { AIAssistantController } from "./aiassistant.controller";
import { fileUploader } from "../../../helpars/fileUploader";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";
import { apiUsage } from "../../../middlewares/apiUsage";
import { assistantStepUsage } from "../../../middlewares/assistantStepUsage";
import { optionalAuth } from "../../../middlewares/optionalAuth";

const router = express.Router();

// General website qualifying call (Feature 5) — not one of the three Feature 4 assistants
router.post(
  "/flashcards",
  optionalAuth(),
  apiUsage(),
  fileUploader.upload.single("file"),
  AIAssistantController.generateFlashcards,
);

// ── Feature 4 assistants: shared 5 free steps ONLY (do NOT consume Feature 5 daily) ──
router.post(
  "/audit/context",
  optionalAuth(),
  assistantStepUsage(),
  AIAssistantController.getAuditContext,
);

router.post(
  "/audit/step",
  optionalAuth(),
  assistantStepUsage(),
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
  assistantStepUsage(),
  AIAssistantController.generateContext,
);

router.post(
  "/iso-suggestions",
  optionalAuth(),
  assistantStepUsage(),
  AIAssistantController.getISOSuggestions,
);

router.post(
  "/benchmark-ai/iso-suggestions",
  optionalAuth(),
  assistantStepUsage(),
  fileUploader.upload.single("file"),
  AIAssistantController.getBenchmarkAISuggestions,
);

router.post(
  "/navigator/generate",
  optionalAuth(),
  assistantStepUsage(),
  AIAssistantController.generateISO,
);

router.post(
  "/navigator/ims-documents",
  optionalAuth(),
  assistantStepUsage(),
  AIAssistantController.getNavigatorImsDocuments,
);

// Assistant follow-up chat counts toward Feature 4 step pool, not Feature 5 daily
router.post(
  "/chat-simple",
  optionalAuth(),
  assistantStepUsage(),
  fileUploader.upload.none(),
  AIAssistantController.simpleChat,
);

// Universal / shared chat — general website Feature 5 allowance
router.post(
  "/chat",
  optionalAuth(),
  apiUsage(),
  fileUploader.upload.single("file"),
  AIAssistantController.chat,
);

router.post(
  "/benchmark/analyze-file",
  optionalAuth(),
  assistantStepUsage(),
  fileUploader.upload.single("file"),
  AIAssistantController.analyzeBenchmarkFile,
);

router.post(
  "/benchmark/analyze-text",
  optionalAuth(),
  assistantStepUsage(),
  AIAssistantController.analyzeBenchmarkText,
);

router.post(
  "/quiz/followup",
  optionalAuth(),
  // Enrichment for an already-metered turn — do not count
  AIAssistantController.generateFollowup,
);

// ── Library (rest of website — Feature 5 daily allowance) ──────────────
router.post(
  "/library/chat",
  optionalAuth(),
  apiUsage(),
  fileUploader.upload.single("file"),
  AIAssistantController.chat,
);

router.post(
  "/library/warm-pdf",
  optionalAuth(),
  // Internal PDF cache warm — must not consume freemium quota
  AIAssistantController.warmLibraryIsoPdf,
);

router.post(
  "/library/flashcards",
  optionalAuth(),
  apiUsage(),
  fileUploader.upload.single("file"),
  AIAssistantController.generateFlashcards,
);

export const AIAssistantRoutes = router;
