import { QuizController } from "./quiz.controller";
import express from "express";
import { fileUploader } from "../../../helpars/fileUploader";
import { apiUsage } from "../../../middlewares/apiUsage";
import { optionalAuth } from "../../../middlewares/optionalAuth";

const router = express.Router();
router.post(
  "/generate",
  // auth(UserRole.SUPER_ADMIN),
  QuizController.generateQuiz,
);

router.post(
  "/quiz-generate",
  // optionalAuth(),
  // apiUsage(),
  QuizController.generateQuizByUser,
);
export const QuizRoutes = router;
