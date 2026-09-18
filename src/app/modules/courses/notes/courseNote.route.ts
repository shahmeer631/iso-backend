import express from "express";
import { CourseNoteController } from "./courseNote.controller";
import auth from "../../../../middlewares/auth";

const router = express.Router();

router.post("/", auth(), CourseNoteController.createCourseNote);
router.get("/all", auth(), CourseNoteController.getAllNotes);
router.get("/course/:courseId", auth(), CourseNoteController.getCourseNotes);
router.get("/:id", auth(), CourseNoteController.getSingleCourseNote);
router.patch("/:id", auth(), CourseNoteController.updateCourseNote);
router.delete("/:id", auth(), CourseNoteController.deleteCourseNote);

export const CourseNoteRoutes = router;
