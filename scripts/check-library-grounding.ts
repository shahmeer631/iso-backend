import {
  detectLibraryTask,
  normalizeLibraryFlashcardDeck,
  sanitizeLibraryAssistantText,
  buildLibraryTaskInstructions,
} from "../src/app/modules/AIAssistant/libraryStandards.grounding";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(detectLibraryTask("Generate a quiz for this standard") === "quiz", "quiz detect");
assert(detectLibraryTask("Generate study notes for ISO 9001") === "notes", "notes detect");
assert(detectLibraryTask("Create a concise summary") === "summary", "summary detect");
assert(
  detectLibraryTask("Generate difficult exam questions for ISO 27001") ===
    "exam_questions",
  "exam detect",
);
assert(
  detectLibraryTask("Can you Give 5 1 liner followup question") === "starter_questions",
  "starter detect",
);

const quizInstr = buildLibraryTaskInstructions("quiz", "ISO 27001:2022");
assert(quizInstr.includes("## Quiz — ISO 27001:2022"), "quiz title interpolated");
assert(!quizInstr.includes("${std}"), "no literal ${std}");

const examInstr = buildLibraryTaskInstructions("exam_questions", "ISO 9001:2026");
assert(examInstr.includes("Evidence"), "exam variety");
assert(!/locked edition/i.test(examInstr), "no locked in instr");

const cleaned = sanitizeLibraryAssistantText(
  "Based on the locked edition and connected ISO standards or knowledge documents, clause 4.1 applies.",
);
assert(!/locked edition/i.test(cleaned), "sanitize locked");
assert(!/connected ISO standards/i.test(cleaned), "sanitize connected");

const deck = normalizeLibraryFlashcardDeck(
  {
    flashcards: [
      { question: "What evidence demonstrates context?", answer: "Internal/external issues records." },
      {
        front: { title: "Q2", body: "Leadership responsibility?" },
        back: { title: "Clause 5", body: "Top management accountability." },
      },
    ],
  },
  "ISO 9001:2026",
);
assert(deck && deck.cards.length === 2, "normalize cards");
assert(deck!.cards[0].front.body.includes("evidence"), "q1 front");

console.log("libraryStandards.grounding self-check OK");
