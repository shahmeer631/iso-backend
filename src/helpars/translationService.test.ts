import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildContentKey,
  getTranslationStatus,
  hashSourceText,
} from "./translationService";
import {
  normalizeLocale,
  resolveAiLanguage,
  SUPPORTED_LOCALES,
} from "./locales";

describe("translation service helpers", () => {
  it("supports the six client locales", () => {
    assert.deepEqual([...SUPPORTED_LOCALES], ["en", "es", "ar", "fr", "it", "hi"]);
    assert.equal(normalizeLocale("AR"), "ar");
    assert.equal(normalizeLocale("hi-IN"), "hi");
  });

  it("builds stable content keys and hashes", () => {
    const h = hashSourceText("Hello");
    assert.equal(h.length, 64);
    assert.equal(
      buildContentKey({
        text: "Hello",
        contentType: "course",
        contentId: "abc",
        field: "title",
      }),
      "course:abc:title",
    );
  });

  it("resolves AI language from locale codes", () => {
    assert.equal(resolveAiLanguage({ locale: "ar" }), "Arabic");
    assert.equal(resolveAiLanguage({ language: "Hindi" }), "Hindi");
    assert.equal(resolveAiLanguage({}), "English");
  });

  it("reports liveEnabled false without credentials", () => {
    const status = getTranslationStatus();
    assert.ok(status.provider === "google" || status.provider === "none");
    // In this environment credentials are typically absent
    if (!process.env.GOOGLE_TRANSLATE_API_KEY && !process.env.GOOGLE_CLOUD_PROJECT_ID) {
      assert.equal(status.liveEnabled, false);
    }
  });
});
