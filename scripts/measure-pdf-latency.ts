import prisma from "../src/shared/prisma";
import {
  getCachedIsoPdfBuffer,
  extractCachedIsoPdfText,
  isoPdfUrlCacheKey,
} from "../src/app/modules/AIAssistant/isoPdfCache";
import { excerptLockedIsoFromBuffer } from "../src/app/modules/AIAssistant/courseLearning.grounding";
import { getLibraryRelatedDocumentExcerpt } from "../src/app/modules/AIAssistant/libraryStandards.grounding";

async function main() {
  const candidates = await prisma.iSOStandard.findMany({
    where: {
      status: "ACTIVE",
      title: { contains: "9001" },
    },
    select: { id: true, title: true, fileUrl: true },
    take: 20,
  });
  const iso = candidates.find((r) => r.fileUrl && !/example\.pdf|placeholder/i.test(r.fileUrl));
  if (!iso?.fileUrl) {
    console.log("no iso");
    process.exit(1);
  }
  console.log("iso", iso.title.slice(0, 70), iso.id);

  let t0 = Date.now();
  const dl1 = await getCachedIsoPdfBuffer(iso.fileUrl);
  console.log(
    "download1",
    Date.now() - t0,
    "ms hit=",
    dl1?.cacheHit,
    "bytes=",
    dl1?.buffer?.length,
  );

  t0 = Date.now();
  const dl2 = await getCachedIsoPdfBuffer(iso.fileUrl);
  console.log("download2", Date.now() - t0, "ms hit=", dl2?.cacheHit);

  if (!dl1) process.exit(1);
  const key = isoPdfUrlCacheKey(iso.fileUrl);

  t0 = Date.now();
  const tx1 = await extractCachedIsoPdfText(key, dl1.buffer);
  console.log(
    "parse1",
    Date.now() - t0,
    "ms hit=",
    tx1.cacheHit,
    "chars=",
    tx1.text.length,
  );

  t0 = Date.now();
  const tx2 = await extractCachedIsoPdfText(key, dl1.buffer);
  console.log("parse2", Date.now() - t0, "ms hit=", tx2.cacheHit);

  t0 = Date.now();
  const ex = await excerptLockedIsoFromBuffer(
    dl1.buffer,
    "What are the leadership requirements in clause 5?",
    "5",
    { cacheKey: key },
  );
  console.log("excerpt", Date.now() - t0, "ms chars=", ex.length);

  t0 = Date.now();
  const related = await getLibraryRelatedDocumentExcerpt({
    isoTitle: iso.title,
    question: "What are the leadership requirements?",
  });
  console.log(
    "relatedDoc",
    Date.now() - t0,
    "ms chars=",
    related.excerpt.length,
    "title=",
    related.title || "n/a",
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
