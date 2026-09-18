import express from "express";
import { CategoryController } from "./category.controller";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";

const router = express.Router();

router.post("/", auth(UserRole.SUPER_ADMIN), CategoryController.createCategory);

router.get("/", CategoryController.getCategories);

router.patch(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  CategoryController.updateCategory,
);

router.delete(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  CategoryController.deleteCategory,
);

export const CategoryRoutes = router;
