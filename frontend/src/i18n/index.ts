import en from "./locales/en";
import fr from "./locales/fr";
import es from "./locales/es";
import ja from "./locales/ja";
import ko from "./locales/ko";
import de from "./locales/de";
import nl from "./locales/nl";
import pt from "./locales/pt";
import pl from "./locales/pl";
import type { TranslationKey } from "./locales/en";

export type Locale = "en" | "fr" | "es" | "ja" | "ko" | "de" | "nl" | "pt" | "pl";

export const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "nl", label: "Nederlands" },
  { code: "pt", label: "Português" },
  { code: "pl", label: "Polski" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
];

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  en,
  fr,
  es,
  ja,
  ko,
  de,
  nl,
  pt,
  pl,
};

const STORAGE_KEY = "dupfinder-locale";

export function getInitialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && LOCALES.some((l) => l.code === stored)) return stored as Locale;
  // No explicit choice yet -- try the OS/browser language as a starting
  // point (same pattern as theme.ts for dark/light mode), falling back to
  // English if it's not one of the 9 supported locales.
  const browserLang = window.navigator.language.slice(0, 2).toLowerCase();
  const match = LOCALES.find((l) => l.code === browserLang);
  return match ? match.code : "en";
}

export function persistLocale(locale: Locale): void {
  window.localStorage.setItem(STORAGE_KEY, locale);
}

// Simple {placeholder} substitution -- deliberately not a full ICU
// MessageFormat setup (plural rules, gender, etc.), which would be
// overkill for an app this size. Every string that needs a count uses a
// single combined template per locale (see the locale files' comments)
// specifically so this simple substitution is sufficient without needing
// real plural-rule logic.
export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  const dict = dictionaries[locale] ?? dictionaries.en;
  let str = dict[key] ?? dictionaries.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.split(`{${k}}`).join(String(v));
    }
  }
  return str;
}

// Dev-time consistency check: every locale should have exactly the same
// keys as English. A missing key silently falls back to English at
// runtime (see translate() above) rather than crashing, but that
// fallback should be a deliberate safety net, not something that goes
// unnoticed during development -- so this surfaces any gap loudly in the
// console instead.
if (import.meta.env.DEV) {
  const enKeys = Object.keys(en);
  for (const { code } of LOCALES) {
    if (code === "en") continue;
    const dict = dictionaries[code] as Record<string, string>;
    const missing = enKeys.filter((k) => !(k in dict));
    if (missing.length > 0) {
      console.warn(`[i18n] locale "${code}" is missing keys:`, missing);
    }
  }
}
