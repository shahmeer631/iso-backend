import express from "express";
import { userController } from "./user.controller";
import auth from "../../../middlewares/auth";
import { requireProfileSetupToken } from "../../../helpars/requireProfileSetupToken";
import { UserRole } from "@prisma/client";

const router = express.Router();

router.delete("/bulk-delete", auth(), userController.bulkDeleteUsers);
router.get("/", auth(UserRole.SUPER_ADMIN), userController.getUsers);
router.post("/register", userController.createUser);
router.put("/profile", requireProfileSetupToken, userController.updateProfile);
router.get("/profile", auth(), userController.getMyProfile);
router.get("/:id", auth(), userController.getUserById);
router.put("/:id", auth(), userController.updateUser);
router.delete("/delete/:id", auth(), userController.deleteUser);

export const UserRoutes = router;
