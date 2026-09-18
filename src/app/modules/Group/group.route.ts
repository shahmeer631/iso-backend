import express from "express";
import { GroupController } from "./group.controller";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";

const router = express.Router();

router.post("/", auth(UserRole.SUPER_ADMIN), GroupController.createGroup);
router.get("/", auth(UserRole.SUPER_ADMIN), GroupController.getAllGroups);
router.get("/:id", auth(UserRole.SUPER_ADMIN), GroupController.getSingleGroup);
router.patch("/:id", auth(UserRole.SUPER_ADMIN), GroupController.updateGroup);
router.delete("/:id", auth(UserRole.SUPER_ADMIN), GroupController.deleteGroup);
router.post(
  "/add-users",
  auth(UserRole.SUPER_ADMIN),
  GroupController.addUsersToGroup,
);

export const GroupRoutes = router;
