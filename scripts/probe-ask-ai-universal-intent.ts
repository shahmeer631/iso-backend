/**
 * Ask AI universal intent / sanitize probe (no DB required).
 * Run: npx tsx scripts/probe-ask-ai-universal-intent.ts
 */
import {
  resolveUniversalAskIntent,
  sanitizeUniversalAskClientContext,
  UNIVERSAL_ASK_HEADER,
} from "../src/app/modules/AIAssistant/universalAsk.grounding";

const cases: Array<{ q: string; expect: string }> = [
  { q: "What does ISO 45001 say about competence?", expect: "document_chat" },
  {
    q: "What documented information is required for that?",
    expect: "document_chat",
  },
  { q: "Tell me about Audit Lens", expect: "module_help" },
  {
    q: "How does ISO Navigator generate documents?",
    expect: "module_help",
  },
  { q: "hi", expect: "greeting" },
  {
    q: "Explain clause 7.5 documented information in ISO 45001",
    expect: "document_chat",
  },
  {
    q: "What should I do on this page?",
    expect: "document_chat", // page help must NOT become module_help
  },
];

let failed = 0;
for (const c of cases) {
  const r = resolveUniversalAskIntent({
    question: c.q,
  });
  const pass = r.intent === c.expect;
  if (!pass) failed += 1;
  console.log(
    JSON.stringify({
      q: c.q,
      intent: r.intent,
      needsIso: r.needsIsoRetrieval,
      needsMod: r.needsModuleContext,
      expect: c.expect,
      pass,
    }),
  );
}

const dirty = sanitizeUniversalAskClientContext({
  purpose: "universal_ask",
  isoStandardId: "69ea562ebf0c135924167014",
  currentModule: "Audit Lens",
  currentRoute: "/ai-assistant/audit-lens",
  libraryContext: "Audit Lens — stage: Stage 1",
  documentContext: "Audit Lens workspace",
  standardTitle: "ISO 45001:2018",
  conversationSnippet: "User: What about competence?",
  userId: "hack",
  tenantId: "hack",
});

const sanitPass =
  dirty.isoStandardId === "69ea562ebf0c135924167014" &&
  dirty.standardTitle === "ISO 45001:2018" &&
  !dirty.currentModule &&
  !dirty.currentRoute &&
  !dirty.libraryContext &&
  !dirty.documentContext &&
  !dirty.userId &&
  !dirty.tenantId;

console.log(JSON.stringify({ sanitPass, dirty }));
console.log(
  JSON.stringify({
    headerNotebook: /universal document chat/i.test(UNIVERSAL_ASK_HEADER),
    headerBlocksWorkflow: /Do NOT transform/i.test(UNIVERSAL_ASK_HEADER),
    failed,
  }),
);

process.exit(failed || !sanitPass ? 1 : 0);
