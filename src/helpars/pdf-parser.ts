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
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: options?.timeoutMs,
    });

    const text = await extractPdfTextFromBuffer(Buffer.from(response.data));
    const maxChars = options?.maxChars ?? 4000;
    return text.slice(0, maxChars);
  } catch (error) {
    console.log("PDF parse failed", error);
    return "";
  }
};

export default extractPdfTextFromUrl;
