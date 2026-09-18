import express from "express";
import { DocumentController } from "./document.controller";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";

const router = express.Router();

router.post("/bulk", auth(UserRole.SUPER_ADMIN), DocumentController.createBulkDocument);
router.post("/", auth(UserRole.SUPER_ADMIN), DocumentController.createDocument);
router.get("/", DocumentController.getDocuments);
router.get("/:id", DocumentController.getSingleDocument);
router.patch(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  DocumentController.updateDocument,
);
router.delete(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  DocumentController.deleteDocument,
);

export const DocumentRoutes = router;
