/**
 * Scan cached ISO 45001 PDF text for documented-information obligation patterns.
 * Run: npx tsx scripts/probe-45001-docinfo-hits.ts
 */
import dotenv from "dotenv";
dotenv.config();

import prisma from "../src/shared/prisma";
import {
  getCachedIsoPdfBuffer,
  extractCachedIsoPdfText,
  isoPdfUrlCacheKey,
} from "../src/app/modules/AIAssistant/isoPdfCache";

const STANDARD_ID = "69ea6720bf0c13592416702d";

function compactAlnum(text: string): string {
  return (text || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function main() {
  const iso = await prisma.iSOStandard.findUnique({
    where: { id: STANDARD_ID },
    select: { fileUrl: true, title: true },
  });
  if (!iso?.fileUrl) throw new Error("missing standard");

  const cached = await getCachedIsoPdfBuffer(iso.fileUrl, { timeoutMs: 90000 });
  if (!cached) throw new Error("download failed");
  const key = isoPdfUrlCacheKey(iso.fileUrl);
  const { text } = await extractCachedIsoPdfText(key, cached.buffer);
  const compact = compactAlnum(text);

  const phrases = [
    "documentedinformation",
    "retaindocumentedinformation",
    "retaineddocumentedinformation",
    "maintaindocumentedinformation",
    "availableasdocumentedinformation",
    "asevidenceof",
    "controlofdocumentedinformation",
  ];

  const counts: Record<string, number> = {};
  for (const p of phrases) {
    let n = 0;
    let i = 0;
    while ((i = compact.indexOf(p, i)) !== -1) {
      n++;
      i += p.length;
    }
    counts[p] = n;
  }

  // Sample windows around each documentedinformation hit (approx map)
  const samples: string[] = [];
  let idx = 0;
  let found = 0;
  while ((idx = compact.indexOf("documentedinformation", idx)) !== -1 && found < 25) {
    const approx = Math.floor((idx / compact.length) * text.length);
    const win = text.slice(Math.max(0, approx - 120), approx + 220).replace(/\s+/g, " ");
    samples.push(win.slice(0, 280));
    idx += "documentedinformation".length;
    found++;
  }

  console.log(JSON.stringify({ title: iso.title, textChars: text.length, counts, samples }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
