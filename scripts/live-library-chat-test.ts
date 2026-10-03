/**
 * Live Library chat smoke test (calls local API).
 * Run: npx tsx scripts/live-library-chat-test.ts
 */
import FormData from "form-data";
import axios from "axios";
import fs from "fs";

const BASE = process.env.API_BASE || "http://localhost:5900/api/v1";
const STANDARD_ID = process.argv[2] || "69ea6720bf0c13592416702d";
const QUESTION =
  process.argv.slice(3).join(" ") ||
  "What is the list of documented information required by ISO 45001:2018?";

async function main() {
  const form = new FormData();
  form.append("messages", QUESTION);
  form.append(
    "context",
    JSON.stringify({
      purpose: "library_standards",
      isoStandardId: STANDARD_ID,
    }),
  );

  const res = await axios.post(`${BASE}/ai-assistant/library/chat`, form, {
    headers: form.getHeaders(),
    timeout: 180000,
    maxBodyLength: Infinity,
    validateStatus: () => true,
  });

  const outPath = "tmp-library-chat-response.json";
  fs.writeFileSync(outPath, JSON.stringify(res.data, null, 2));
  console.log("status", res.status);
  const text =
    res.data?.response ||
    res.data?.data?.response ||
    res.data?.message ||
    "";
  console.log("responseChars", String(text).length);
  console.log("---PREVIEW---");
  console.log(String(text).slice(0, 2500));
}

main().catch((e) => {
  console.error(e?.response?.data || e);
  process.exit(1);
});
