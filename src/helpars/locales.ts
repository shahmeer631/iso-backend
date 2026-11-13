/**
 * Canonical locale contract for ISOBrain.AI (backend).
 * Keep in sync with frontend `lib/i18n/locales.ts` and dashboard `lib/locales.ts`.
 */

export const SUPPORTED_LOCALES = ["en", "es", "ar", "fr", "it", "hi"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

export const RTL_LOCALES: readonly AppLocale[] = ["ar"];

export const LOCALE_AI_LANGUAGE: Record<AppLocale, string> = {
  en: "English",
  es: "Spanish",
  ar: "Arabic",
  fr: "French",
  it: "Italian",
  hi: "Hindi",
};

/** BCP-47 / Google Translate target codes */
export const LOCALE_GOOGLE_TARGET: Record<AppLocale, string> = {
  en: "en",
  es: "es",
  ar: "ar",
  fr: "fr",
  it: "it",
  hi: "hi",
};

export function isAppLocale(value: unknown): value is AppLocale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

export function normalizeLocale(value: unknown): AppLocale {
  if (isAppLocale(value)) return value;
  if (typeof value === "string") {
    const base = value.toLowerCase().split("-")[0];
    if (isAppLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export function isRtlLocale(locale: string): boolean {
  return (RTL_LOCALES as readonly string[]).includes(normalizeLocale(locale));
}

export function localeToAiLanguage(locale: string): string {
  return LOCALE_AI_LANGUAGE[normalizeLocale(locale)];
}

export function resolveAiLanguage(input: {
  language?: unknown;
  locale?: unknown;
  preferredLanguage?: unknown;
}): string {
  const language = String(input.language || "").trim();
  if (language) {
    if (isAppLocale(language.toLowerCase())) {
      return localeToAiLanguage(language.toLowerCase());
    }
    return language;
  }
  const locale = input.locale ?? input.preferredLanguage;
  if (locale) return localeToAiLanguage(String(locale));
  return LOCALE_AI_LANGUAGE.en;
}

export function buildLocaleOutputInstructions(language: string): string {
  const lang = String(language || "English").trim() || "English";
  return [
    `LANGUAGE: Write all user-facing content in ${lang}.`,
    "Keep technical meaning accurate for ISO/compliance use.",
    "Preserve ISO standard identifiers, clause numbers, acronyms, and official document references in their original form.",
    "Do not translate JSON keys, code, database field names, or machine-readable identifiers.",
    "Do not unnecessarily mix English with the selected language except for unavoidable technical terms.",
    "Preserve the required output structure and heading schema exactly.",
  ].join("\n");
}
