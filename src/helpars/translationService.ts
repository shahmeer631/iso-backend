/**
 * Central Google Cloud Translation service (hybrid architecture).
 *
 * Auth (server-side only):
 * - GOOGLE_TRANSLATE_API_KEY → Translation API v2 REST
 * - GOOGLE_APPLICATION_CREDENTIALS / ADC → Translation API v3 via google-auth-library
 *
 * Never expose credentials to the frontend.
 */

import crypto from "crypto";
import axios from "axios";
import { GoogleAuth } from "google-auth-library";
import prisma from "../shared/prisma";
import {
  AppLocale,
  DEFAULT_LOCALE,
  isAppLocale,
  LOCALE_GOOGLE_TARGET,
  normalizeLocale,
} from "./locales";

export type TranslationProviderName = "none" | "google";

export type TranslationStatus =
  | "pending"
  | "machine_translated"
  | "review_required"
  | "reviewed"
  | "failed";

export type TranslateParams = {
  text: string;
  targetLocale: string;
  sourceLocale?: string;
  contentType?: string;
  contentId?: string;
  field?: string;
  /** Skip DB/memory cache */
  bypassCache?: boolean;
  /** Mark result as needing human review (e.g. Mastery questions) */
  reviewRequired?: boolean;
};

export type TranslateResult = {
  text: string;
  provider: TranslationProviderName;
  cached: boolean;
  translated: boolean;
  targetLocale: AppLocale;
  sourceLocale: string;
  status: TranslationStatus;
};

const memoryCache = new Map<string, { text: string; expiresAt: number }>();

const getProvider = (): TranslationProviderName => {
  const raw = String(process.env.TRANSLATION_PROVIDER || "google")
    .trim()
    .toLowerCase();
  if (raw === "none") return "none";
  return "google";
};

export const isTranslationLiveConfigured = (): boolean => {
  if (getProvider() !== "google") return false;
  return Boolean(
    process.env.GOOGLE_TRANSLATE_API_KEY ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GOOGLE_CLOUD_PROJECT_ID,
  );
};

const cacheEnabled = () =>
  String(process.env.TRANSLATION_CACHE_ENABLED || "true").toLowerCase() !==
  "false";

const cacheTtlMs = () => {
  const sec = Number(process.env.TRANSLATION_CACHE_TTL || 60 * 60 * 24 * 30);
  return (Number.isFinite(sec) && sec > 0 ? sec : 2592000) * 1000;
};

const maxBatchSize = () => {
  const n = Number(process.env.TRANSLATION_MAX_BATCH_SIZE || 50);
  return Number.isFinite(n) && n > 0 ? Math.min(128, Math.floor(n)) : 50;
};

const requestTimeoutMs = () => {
  const n = Number(process.env.TRANSLATION_REQUEST_TIMEOUT || 30000);
  return Number.isFinite(n) && n > 0 ? n : 30000;
};

export const hashSourceText = (text: string): string =>
  crypto.createHash("sha256").update(text, "utf8").digest("hex");

export const buildContentKey = (params: {
  text: string;
  contentType?: string;
  contentId?: string;
  field?: string;
}): string => {
  if (params.contentType && params.contentId && params.field) {
    return `${params.contentType}:${params.contentId}:${params.field}`;
  }
  return `text:${hashSourceText(params.text)}`;
};

const memKey = (
  contentKey: string,
  target: AppLocale,
  sourceHash: string,
) => `${contentKey}::${target}::${sourceHash}`;

async function translateViaApiKey(
  texts: string[],
  target: AppLocale,
  source?: string,
): Promise<string[]> {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!key) throw new Error("GOOGLE_TRANSLATE_API_KEY missing");

  const params: Record<string, string | string[]> = {
    key,
    q: texts,
    target: LOCALE_GOOGLE_TARGET[target],
    format: "text",
  };
  if (source && source !== "auto") {
    params.source = LOCALE_GOOGLE_TARGET[normalizeLocale(source)] || source;
  }

  const res = await axios.post(
    "https://translation.googleapis.com/language/translate/v2",
    null,
    {
      params,
      timeout: requestTimeoutMs(),
      // axios serializes array params as q=a&q=b with paramsSerializer default in newer axios
      paramsSerializer: {
        indexes: null,
      },
    },
  );

  const translations = res.data?.data?.translations;
  if (!Array.isArray(translations) || translations.length !== texts.length) {
    throw new Error("Unexpected Google Translate v2 response shape");
  }
  return translations.map((t: any) => String(t.translatedText ?? ""));
}

async function translateViaAdc(
  texts: string[],
  target: AppLocale,
  source?: string,
): Promise<string[]> {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT;
  if (!projectId) {
    throw new Error(
      "GOOGLE_CLOUD_PROJECT_ID required for ADC / service-account Translation API v3",
    );
  }
  const location = process.env.GOOGLE_TRANSLATION_LOCATION || "global";
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-translation"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token?.token) throw new Error("Failed to obtain Google access token");

  const parent = `projects/${projectId}/locations/${location}`;
  const body: Record<string, unknown> = {
    contents: texts,
    mimeType: "text/plain",
    targetLanguageCode: LOCALE_GOOGLE_TARGET[target],
  };
  if (source && source !== "auto") {
    body.sourceLanguageCode =
      LOCALE_GOOGLE_TARGET[normalizeLocale(source)] || source;
  }
  const glossary = process.env.GOOGLE_TRANSLATION_GLOSSARY_ID;
  if (glossary) {
    body.glossaryConfig = {
      glossary: glossary.startsWith("projects/")
        ? glossary
        : `${parent}/glossaries/${glossary}`,
    };
  }

  const url = `https://translation.googleapis.com/v3/${parent}:translateText`;
  const res = await axios.post(url, body, {
    headers: { Authorization: `Bearer ${token.token}` },
    timeout: requestTimeoutMs(),
  });

  const translations = res.data?.translations;
  if (!Array.isArray(translations) || translations.length !== texts.length) {
    throw new Error("Unexpected Google Translate v3 response shape");
  }
  return translations.map((t: any) =>
    String(t.translatedText ?? t.glossaryTranslatedText ?? ""),
  );
}

async function callGoogleTranslate(
  texts: string[],
  target: AppLocale,
  source?: string,
): Promise<string[]> {
  if (process.env.GOOGLE_TRANSLATE_API_KEY) {
    return translateViaApiKey(texts, target, source);
  }
  return translateViaAdc(texts, target, source);
}

async function readDbCache(
  contentKey: string,
  targetLocale: AppLocale,
  sourceHash: string,
): Promise<string | null> {
  if (!cacheEnabled()) return null;
  try {
    const row = await prisma.translationCache.findFirst({
      where: {
        contentKey,
        targetLocale,
        sourceHash,
        status: { in: ["machine_translated", "review_required", "reviewed"] },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (!row?.translatedText) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
    return row.translatedText;
  } catch (err) {
    console.warn("[translation] cache read failed:", (err as Error)?.message);
    return null;
  }
}

async function writeDbCache(input: {
  contentKey: string;
  sourceLocale: string;
  targetLocale: AppLocale;
  sourceHash: string;
  sourceText: string;
  translatedText: string;
  contentType?: string;
  contentId?: string;
  field?: string;
  status: TranslationStatus;
}): Promise<void> {
  if (!cacheEnabled()) return;
  try {
    const existing = await prisma.translationCache.findFirst({
      where: {
        contentKey: input.contentKey,
        targetLocale: input.targetLocale,
        sourceHash: input.sourceHash,
      },
    });
    const data = {
      sourceLocale: input.sourceLocale,
      sourceText: input.sourceText.slice(0, 20000),
      translatedText: input.translatedText,
      provider: "google",
      contentType: input.contentType || null,
      contentId: input.contentId || null,
      field: input.field || null,
      status: input.status,
      expiresAt: new Date(Date.now() + cacheTtlMs()),
    };
    if (existing) {
      await prisma.translationCache.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.translationCache.create({
        data: {
          contentKey: input.contentKey,
          targetLocale: input.targetLocale,
          sourceHash: input.sourceHash,
          ...data,
        },
      });
    }
  } catch (err) {
    console.warn("[translation] cache write failed:", (err as Error)?.message);
  }
}

/**
 * Translate a single string. Falls back to original text when provider unavailable.
 */
export async function translateText(
  params: TranslateParams,
): Promise<TranslateResult> {
  const text = String(params.text || "");
  const targetLocale = normalizeLocale(params.targetLocale);
  const sourceLocale = params.sourceLocale
    ? normalizeLocale(params.sourceLocale)
    : DEFAULT_LOCALE;

  if (!text.trim()) {
    return {
      text,
      provider: "none",
      cached: false,
      translated: false,
      targetLocale,
      sourceLocale,
      status: "pending",
    };
  }

  if (targetLocale === sourceLocale) {
    return {
      text,
      provider: "none",
      cached: false,
      translated: false,
      targetLocale,
      sourceLocale,
      status: "reviewed",
    };
  }

  const contentKey = buildContentKey({
    text,
    contentType: params.contentType,
    contentId: params.contentId,
    field: params.field,
  });
  const sourceHash = hashSourceText(text);
  const mKey = memKey(contentKey, targetLocale, sourceHash);

  if (!params.bypassCache && cacheEnabled()) {
    const mem = memoryCache.get(mKey);
    if (mem && mem.expiresAt > Date.now()) {
      return {
        text: mem.text,
        provider: "google",
        cached: true,
        translated: true,
        targetLocale,
        sourceLocale,
        status: "machine_translated",
      };
    }
    const dbHit = await readDbCache(contentKey, targetLocale, sourceHash);
    if (dbHit) {
      memoryCache.set(mKey, { text: dbHit, expiresAt: Date.now() + cacheTtlMs() });
      return {
        text: dbHit,
        provider: "google",
        cached: true,
        translated: true,
        targetLocale,
        sourceLocale,
        status: "machine_translated",
      };
    }
  }

  if (getProvider() === "none" || !isTranslationLiveConfigured()) {
    console.warn(
      "[translation] Google Translation not configured; returning source text.",
    );
    return {
      text,
      provider: "none",
      cached: false,
      translated: false,
      targetLocale,
      sourceLocale,
      status: "failed",
    };
  }

  try {
    const [translated] = await callGoogleTranslate(
      [text],
      targetLocale,
      sourceLocale,
    );
    const status: TranslationStatus = params.reviewRequired
      ? "review_required"
      : "machine_translated";
    memoryCache.set(mKey, {
      text: translated,
      expiresAt: Date.now() + cacheTtlMs(),
    });
    await writeDbCache({
      contentKey,
      sourceLocale,
      targetLocale,
      sourceHash,
      sourceText: text,
      translatedText: translated,
      contentType: params.contentType,
      contentId: params.contentId,
      field: params.field,
      status,
    });
    return {
      text: translated,
      provider: "google",
      cached: false,
      translated: true,
      targetLocale,
      sourceLocale,
      status,
    };
  } catch (err) {
    console.error(
      "[translation] Google provider failure (text not logged):",
      (err as Error)?.message || err,
    );
    return {
      text,
      provider: "google",
      cached: false,
      translated: false,
      targetLocale,
      sourceLocale,
      status: "failed",
    };
  }
}

export async function translateBatch(
  items: Array<Omit<TranslateParams, "bypassCache"> & { bypassCache?: boolean }>,
): Promise<TranslateResult[]> {
  const results: TranslateResult[] = [];
  const pending: Array<{ index: number; params: TranslateParams; contentKey: string; sourceHash: string }> = [];

  for (let i = 0; i < items.length; i++) {
    const params = items[i];
    const text = String(params.text || "");
    const targetLocale = normalizeLocale(params.targetLocale);
    const sourceLocale = params.sourceLocale
      ? normalizeLocale(params.sourceLocale)
      : DEFAULT_LOCALE;

    if (!text.trim() || targetLocale === sourceLocale) {
      results[i] = {
        text,
        provider: "none",
        cached: false,
        translated: false,
        targetLocale,
        sourceLocale,
        status: targetLocale === sourceLocale ? "reviewed" : "pending",
      };
      continue;
    }

    const contentKey = buildContentKey({
      text,
      contentType: params.contentType,
      contentId: params.contentId,
      field: params.field,
    });
    const sourceHash = hashSourceText(text);
    const mKey = memKey(contentKey, targetLocale, sourceHash);

    if (!params.bypassCache && cacheEnabled()) {
      const mem = memoryCache.get(mKey);
      if (mem && mem.expiresAt > Date.now()) {
        results[i] = {
          text: mem.text,
          provider: "google",
          cached: true,
          translated: true,
          targetLocale,
          sourceLocale,
          status: "machine_translated",
        };
        continue;
      }
      const dbHit = await readDbCache(contentKey, targetLocale, sourceHash);
      if (dbHit) {
        memoryCache.set(mKey, {
          text: dbHit,
          expiresAt: Date.now() + cacheTtlMs(),
        });
        results[i] = {
          text: dbHit,
          provider: "google",
          cached: true,
          translated: true,
          targetLocale,
          sourceLocale,
          status: "machine_translated",
        };
        continue;
      }
    }

    pending.push({ index: i, params, contentKey, sourceHash });
  }

  if (!pending.length) return results;

  if (getProvider() === "none" || !isTranslationLiveConfigured()) {
    for (const p of pending) {
      results[p.index] = {
        text: String(p.params.text || ""),
        provider: "none",
        cached: false,
        translated: false,
        targetLocale: normalizeLocale(p.params.targetLocale),
        sourceLocale: p.params.sourceLocale
          ? normalizeLocale(p.params.sourceLocale)
          : DEFAULT_LOCALE,
        status: "failed",
      };
    }
    return results;
  }

  // Group by target locale for batch API calls
  const byTarget = new Map<AppLocale, typeof pending>();
  for (const p of pending) {
    const t = normalizeLocale(p.params.targetLocale);
    const list = byTarget.get(t) || [];
    list.push(p);
    byTarget.set(t, list);
  }

  for (const [target, group] of byTarget) {
    for (let offset = 0; offset < group.length; offset += maxBatchSize()) {
      const chunk = group.slice(offset, offset + maxBatchSize());
      const texts = chunk.map((c) => String(c.params.text || ""));
      try {
        const translated = await callGoogleTranslate(texts, target, "en");
        for (let i = 0; i < chunk.length; i++) {
          const item = chunk[i];
          const out = translated[i] ?? texts[i];
          const sourceLocale = item.params.sourceLocale
            ? normalizeLocale(item.params.sourceLocale)
            : DEFAULT_LOCALE;
          const status: TranslationStatus = item.params.reviewRequired
            ? "review_required"
            : "machine_translated";
          memoryCache.set(memKey(item.contentKey, target, item.sourceHash), {
            text: out,
            expiresAt: Date.now() + cacheTtlMs(),
          });
          await writeDbCache({
            contentKey: item.contentKey,
            sourceLocale,
            targetLocale: target,
            sourceHash: item.sourceHash,
            sourceText: texts[i],
            translatedText: out,
            contentType: item.params.contentType,
            contentId: item.params.contentId,
            field: item.params.field,
            status,
          });
          results[item.index] = {
            text: out,
            provider: "google",
            cached: false,
            translated: true,
            targetLocale: target,
            sourceLocale,
            status,
          };
        }
      } catch (err) {
        console.error(
          "[translation] batch failure:",
          (err as Error)?.message || err,
        );
        for (const item of chunk) {
          results[item.index] = {
            text: String(item.params.text || ""),
            provider: "google",
            cached: false,
            translated: false,
            targetLocale: target,
            sourceLocale: item.params.sourceLocale
              ? normalizeLocale(item.params.sourceLocale)
              : DEFAULT_LOCALE,
            status: "failed",
          };
        }
      }
    }
  }

  return results;
}

/**
 * Translate user-facing string fields inside a plain object; preserve keys/ids.
 */
export async function translateUserFacingFields<T extends Record<string, any>>(
  obj: T,
  fields: string[],
  targetLocale: string,
  meta?: { contentType?: string; contentId?: string },
): Promise<T> {
  const locale = normalizeLocale(targetLocale);
  if (locale === DEFAULT_LOCALE) return obj;

  const items = fields
    .filter((f) => typeof obj[f] === "string" && String(obj[f]).trim())
    .map((f) => ({
      text: String(obj[f]),
      targetLocale: locale,
      sourceLocale: DEFAULT_LOCALE,
      contentType: meta?.contentType,
      contentId: meta?.contentId,
      field: f,
    }));

  if (!items.length) return obj;
  const translated = await translateBatch(items);
  const out: Record<string, unknown> = { ...obj };
  let ti = 0;
  for (const f of fields) {
    if (typeof obj[f] === "string" && String(obj[f]).trim()) {
      out[f] = translated[ti]?.text ?? obj[f];
      ti += 1;
    }
  }
  return out as T;
}

export function getTranslationStatus(): {
  provider: TranslationProviderName;
  credentialsPresent: boolean;
  liveEnabled: boolean;
} {
  const provider = getProvider();
  const credentialsPresent = isTranslationLiveConfigured();
  return {
    provider,
    credentialsPresent,
    liveEnabled: provider === "google" && credentialsPresent,
  };
}

export function assertSupportedLocale(value: unknown): AppLocale {
  if (!isAppLocale(value)) {
    throw new Error(`Unsupported locale: ${String(value)}`);
  }
  return value;
}
