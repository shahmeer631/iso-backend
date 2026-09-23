import express from "express";
import { UserRole } from "@prisma/client";
import { GroupController } from "./group.controller";
import auth from "../../../middlewares/auth";

const router = express.Router();

// All group management is SUPER_ADMIN only
router.post("/", auth(UserRole.SUPER_ADMIN), GroupController.createGroup);
router.get("/", auth(UserRole.SUPER_ADMIN), GroupController.getAllGroups);

// Legacy body-based add (groupId + userIds) — register before /:id
router.post(
  "/add-users",
  auth(UserRole.SUPER_ADMIN),
  GroupController.addUsersToGroup,
);

router.post(
  "/:id/members",
  auth(UserRole.SUPER_ADMIN),
  GroupController.addUsersToGroup,
);
router.delete(
  "/:id/members/:userId",
  auth(UserRole.SUPER_ADMIN),
  GroupController.removeUserFromGroup,
);

router.get("/:id", auth(UserRole.SUPER_ADMIN), GroupController.getSingleGroup);
router.patch("/:id", auth(UserRole.SUPER_ADMIN), GroupController.updateGroup);
router.delete("/:id", auth(UserRole.SUPER_ADMIN), GroupController.deleteGroup);

export const GroupRoutes = router;
