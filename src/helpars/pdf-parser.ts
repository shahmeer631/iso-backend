import axios from "axios";

/**
 * pdf-parse v1 exported a function. v2 exports `{ PDFParse }` class.
 * Resolve either shape so Library/ISO PDF grounding does not crash.
 */
function resolvePdfParse(): {
  parseBuffer: (data: Buffer | Uint8Array) => Promise<{ text?: string }>;
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
          return { text: result?.text || "" };
        } finally {
          if (typeof parser.destroy === "function") {
            await parser.destroy();
          }
        }
      },
    };
  }

  if (typeof fn === "function") {
    return { parseBuffer: fn };
  }

  throw new Error("pdf-parse module did not export a parser");
}

const parser = resolvePdfParse();

export async function extractPdfTextFromBuffer(
  data: Buffer | Uint8Array,
): Promise<string> {
  const result = await parser.parseBuffer(data);
  return (result?.text || "").trim();
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
