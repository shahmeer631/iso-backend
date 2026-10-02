/**
 * Process-local ISO PDF buffer + extracted-text cache.
 * ISO Library PDFs are platform-shared (not tenant-private) — safe to cache by fileUrl.
 * Never use this for tenant/user private uploads.
 */

type BufferEntry = {
  buffer: Buffer;
  originalname: string;
  expiresAt: number;
};

type TextEntry = {
  text: string;
  expiresAt: number;
};

const BUFFER_CACHE = new Map<string, BufferEntry>();
const TEXT_CACHE = new Map<string, TextEntry>();
const INFLIGHT_DOWNLOAD = new Map<string, Promise<BufferEntry | null>>();

const TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 48;

function touchEvict<T extends { expiresAt: number }>(
  map: Map<string, T>,
  key: string,
  entry: T,
) {
  if (map.size >= MAX_ENTRIES && !map.has(key)) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
  map.set(key, entry);
}

function bufferFingerprint(buffer: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const head = buf.subarray(0, Math.min(64, buf.length)).toString("hex");
  const tail =
    buf.length > 64
      ? buf.subarray(buf.length - 64).toString("hex")
      : "";
  return `buf:${buf.length}:${head}:${tail}`;
}

export function getCachedIsoPdfText(cacheKey: string): string | null {
  const hit = TEXT_CACHE.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.text;
  if (hit) TEXT_CACHE.delete(cacheKey);
  return null;
}

export function setCachedIsoPdfText(cacheKey: string, text: string): void {
  if (!text) return;
  touchEvict(TEXT_CACHE, cacheKey, {
    text,
    expiresAt: Date.now() + TTL_MS,
  });
}

/** Cache key for a downloaded ISO PDF URL. */
export function isoPdfUrlCacheKey(fileUrl: string): string {
  return `url:${String(fileUrl || "").trim()}`;
}

/** Cache key for an in-memory buffer (session upload). */
export function isoPdfBufferCacheKey(buffer: Buffer | Uint8Array): string {
  return bufferFingerprint(buffer);
}

/**
 * Download ISO PDF once per URL (coalesces concurrent downloads).
 */
export async function getCachedIsoPdfBuffer(
  fileUrl: string,
  options?: { timeoutMs?: number },
): Promise<{
  buffer: Buffer;
  originalname: string;
  cacheHit: boolean;
} | null> {
  const url = String(fileUrl || "").trim();
  if (!url || /example\.pdf|placeholder/i.test(url)) return null;

  const key = isoPdfUrlCacheKey(url);
  const hit = BUFFER_CACHE.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { buffer: hit.buffer, originalname: hit.originalname, cacheHit: true };
  }
  if (hit) BUFFER_CACHE.delete(key);

  const existing = INFLIGHT_DOWNLOAD.get(key);
  if (existing) {
    const shared = await existing;
    if (!shared) return null;
    return {
      buffer: shared.buffer,
      originalname: shared.originalname,
      cacheHit: true,
    };
  }

  const axios = (await import("axios")).default;
  const timeoutMs = options?.timeoutMs ?? 60000;

  const work = (async (): Promise<BufferEntry | null> => {
    try {
      const fileRes = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: timeoutMs,
        maxContentLength: 40 * 1024 * 1024,
        maxBodyLength: 40 * 1024 * 1024,
      });
      const buffer = Buffer.from(fileRes.data);
      const originalname = url.split("/").pop() || "document.pdf";
      const entry: BufferEntry = {
        buffer,
        originalname,
        expiresAt: Date.now() + TTL_MS,
      };
      touchEvict(BUFFER_CACHE, key, entry);
      // Also seed text fingerprint key later when parsed
      return entry;
    } catch (error: any) {
      console.error(
        `[IsoPdfCache] download failed url=${url.slice(0, 80)} status=${error?.response?.status || "n/a"} message=${error?.message || error}`,
      );
      return null;
    } finally {
      INFLIGHT_DOWNLOAD.delete(key);
    }
  })();

  INFLIGHT_DOWNLOAD.set(key, work);
  const entry = await work;
  if (!entry) return null;
  return {
    buffer: entry.buffer,
    originalname: entry.originalname,
    cacheHit: false,
  };
}

/**
 * Extract PDF text with process-local cache (by URL key or buffer fingerprint).
 */
export async function extractCachedIsoPdfText(
  cacheKey: string,
  buffer: Buffer | Uint8Array,
): Promise<{ text: string; cacheHit: boolean }> {
  const cached = getCachedIsoPdfText(cacheKey);
  if (cached != null) {
    return { text: cached, cacheHit: true };
  }

  const { extractPdfTextFromBuffer } = await import("../../../helpars/pdf-parser");
  const text = ((await extractPdfTextFromBuffer(buffer)) || "")
    .replace(/\s+/g, " ")
    .trim();
  setCachedIsoPdfText(cacheKey, text);
  // Also store under buffer fingerprint for buffer-only callers
  setCachedIsoPdfText(isoPdfBufferCacheKey(buffer), text);
  return { text, cacheHit: false };
}
