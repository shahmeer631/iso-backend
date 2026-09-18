import express from "express";
import { ReviewController } from "./review.controller";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";

const router = express.Router();

router.get("/", auth(UserRole.SUPER_ADMIN), ReviewController.getReviews); 
router.post("/", auth(UserRole.USER), ReviewController.createReview);

export const ReviewRoutes = router;
