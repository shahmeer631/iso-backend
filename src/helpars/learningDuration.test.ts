import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatDurationLabel,
  parseDurationToSeconds,
  sumVideoDurationsSeconds,
} from "./learningDuration";

describe("parseDurationToSeconds", () => {
  it("parses M:SS", () => {
    assert.equal(parseDurationToSeconds("8:30"), 510);
    assert.equal(parseDurationToSeconds("0:45"), 45);
  });

  it("parses H:MM:SS", () => {
    assert.equal(parseDurationToSeconds("1:05:00"), 3900);
  });

  it("returns 0 for invalid values", () => {
    assert.equal(parseDurationToSeconds(null), 0);
    assert.equal(parseDurationToSeconds(""), 0);
    assert.equal(parseDurationToSeconds("abc"), 0);
  });
});

describe("formatDurationLabel", () => {
  it("formats zero and sub-hour values", () => {
    assert.equal(formatDurationLabel(0), "0h");
    assert.equal(formatDurationLabel(90), "2m");
    assert.equal(formatDurationLabel(45 * 60), "45m");
  });

  it("formats hours with optional minutes", () => {
    assert.equal(formatDurationLabel(2 * 3600), "2h");
    assert.equal(formatDurationLabel(2 * 3600 + 15 * 60), "2h 15m");
  });
});

describe("sumVideoDurationsSeconds", () => {
  it("sums lesson video durations", () => {
    const total = sumVideoDurationsSeconds([
      { video: { duration: "8:30" } },
      { video: { duration: "6:30" } },
      { video: null },
    ]);
    assert.equal(total, 510 + 390);
  });
});
