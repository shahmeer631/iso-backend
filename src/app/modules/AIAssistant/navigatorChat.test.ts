import assert from "node:assert/strict";
import test from "node:test";
import {
  isNavigatorChatContext,
  looksLikeNavigatorImsAnalysisQuestion,
} from "./navigatorChat";

test("isNavigatorChatContext detects Navigator purpose only", () => {
  assert.equal(isNavigatorChatContext({ purpose: "iso_navigator" }), true);
  assert.equal(isNavigatorChatContext({ purpose: "navigator" }), true);
  assert.equal(isNavigatorChatContext({ navigator: true }), true);
  assert.equal(isNavigatorChatContext({ purpose: "universal_ask" }), false);
  assert.equal(isNavigatorChatContext({ full_document_context: "hello" }), false);
});

test("looksLikeNavigatorImsAnalysisQuestion covers natural-language IMS intents", () => {
  assert.equal(
    looksLikeNavigatorImsAnalysisQuestion(
      "List the documents required for the IMS.",
    ),
    true,
  );
  assert.equal(
    looksLikeNavigatorImsAnalysisQuestion(
      "Which requirements can be integrated?",
    ),
    true,
  );
  assert.equal(
    looksLikeNavigatorImsAnalysisQuestion(
      "What remains specific to ISO 45001?",
    ),
    true,
  );
  assert.equal(
    looksLikeNavigatorImsAnalysisQuestion(
      "Give me information about the Integrated Management System.",
    ),
    true,
  );
  assert.equal(
    looksLikeNavigatorImsAnalysisQuestion("What is a SIPOC diagram?"),
    false,
  );
});
