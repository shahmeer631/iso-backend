import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FREE_LESSONS_PER_COURSE,
  ACADEMY_LESSON_LOCKED_CODE,
  isFreeLessonRank,
  redactLockedLesson,
} from "./academyLessonAccess";

describe("Academy first-two-lessons-free policy", () => {
  it("allows exactly two free lessons per course/module", () => {
    assert.equal(FREE_LESSONS_PER_COURSE, 2);
  });

  it("classifies ranks 1 and 2 as free, 3+ as paid", () => {
    assert.equal(isFreeLessonRank(1), true);
    assert.equal(isFreeLessonRank(2), true);
    assert.equal(isFreeLessonRank(3), false);
    assert.equal(isFreeLessonRank(0), false);
    assert.equal(isFreeLessonRank(-1), false);
  });

  it("redacts protected lesson content while preserving list metadata", () => {
    const locked = redactLockedLesson(
      {
        id: "l3",
        title: "Lesson 3",
        order: 3,
        courseId: "c1",
        content: "secret body",
        videoId: "v1",
        video: { id: "v1", videoUrl: "https://example.com/secret.mp4" },
        quizzes: [{ id: "q1", questions: [{ id: "qq1", answer: "A" }] }],
        pdfUrl: "https://example.com/secret.pdf",
      },
      3,
    );

    assert.equal(locked.id, "l3");
    assert.equal(locked.title, "Lesson 3");
    assert.equal(locked.order, 3);
    assert.equal(locked.content, null);
    assert.equal(locked.video, null);
    assert.equal(locked.videoId, null);
    assert.deepEqual(locked.quizzes, []);
    assert.equal(locked.pdfUrl, null);
    assert.equal(locked.isLocked, true);
    assert.equal(locked.isFreePreview, false);
    assert.equal(locked.freeAccessRank, 3);
  });

  it("exposes a stable locked-lesson error code", () => {
    assert.equal(ACADEMY_LESSON_LOCKED_CODE, "ACADEMY_LESSON_LOCKED");
  });
});
