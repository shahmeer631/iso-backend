import axios from "axios";

export type PdfExtractResult = {
  text: string;
  pageCount: number;
};

/**
 * pdf-parse v1 exported a function. v2 exports `{ PDFParse }` class.
 * Resolve either shape so Library/ISO PDF grounding does not crash.
 */
function resolvePdfParse(): {
  parseBuffer: (data: Buffer | Uint8Array) => Promise<PdfExtractResult>;
} {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("pdf-parse");
  const PDFParseClass = mod?.PDFParse || mod?.default?.PDFParse;
  const fn = typeof mod === "function" ? mod : mod?.default;

  if (PDFParseClass && typeof PDFParseClass === "function") {
    return {
      parseBuffer: async (data: Buffer | Uint8Array) => {
        const parser = new PDFParseClass({ data });
        try {
          const result = await parser.getText();
          const total = Number(result?.total) || 0;
          const pages: Array<{ text?: string; num?: number }> = Array.isArray(
            result?.pages,
          )
            ? result.pages
            : [];

          // Inject stable page markers so retrieval diagnostics can map
          // character offsets → PDF page numbers across the FULL document.
          if (pages.length > 0) {
            const pageCount = total || pages.length;
            const joined = pages
              .map((p, i) => {
                const n = Number(p?.num) > 0 ? Number(p.num) : i + 1;
                const body = String(p?.text || "").trim();
                return `-- ${n} of ${pageCount} --\n${body}`;
              })
              .join("\n\n");
            return { text: joined, pageCount };
          }

          return {
            text: String(result?.text || ""),
            pageCount: total || 0,
          };
        } finally {
          if (typeof parser.destroy === "function") {
            await parser.destroy();
          }
        }
      },
    };
  }

  if (typeof fn === "function") {
    return {
      parseBuffer: async (data: Buffer | Uint8Array) => {
        const result = await fn(data);
        return {
          text: String(result?.text || ""),
          pageCount: Number(result?.numpages || result?.total || 0) || 0,
        };
      },
    };
  }

  throw new Error("pdf-parse module did not export a parser");
}

const parser = resolvePdfParse();

/** Full extract with page markers (`-- N of M --`) when available. */
export async function extractPdfFromBuffer(
  data: Buffer | Uint8Array,
): Promise<PdfExtractResult> {
  const result = await parser.parseBuffer(data);
  return {
    text: (result?.text || "").trim(),
    pageCount: Number(result?.pageCount) || 0,
  };
}

export async function extractPdfTextFromBuffer(
  data: Buffer | Uint8Array,
): Promise<string> {
  const result = await extractPdfFromBuffer(data);
  return result.text;
}

const extractPdfTextFromUrl = async (
  url: string,
  options?: { timeoutMs?: number; maxChars?: number },
) => {
  const timeoutMs = options?.timeoutMs ?? 25000;
  const maxChars = options?.maxChars ?? 4000;
  try {
    const work = (async () => {
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: timeoutMs,
        // Bound download size — full ISO PDFs can be tens of MB
        maxContentLength: 8 * 1024 * 1024,
        maxBodyLength: 8 * 1024 * 1024,
      });

      const text = await extractPdfTextFromBuffer(Buffer.from(response.data));
      return text.slice(0, maxChars);
    })();

    // Hard ceiling includes parse time (axios timeout only covers download).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raced = await Promise.race([
      work,
      new Promise<string>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`PDF extract timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    return raced;
  } catch (error) {
    console.log("PDF parse failed", error);
    return "";
  }
};

export default extractPdfTextFromUrl;
