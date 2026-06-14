import React, { createContext, useContext, useEffect, useState } from "react";
import { LANGS, STRINGS, type Key, type Lang } from "./strings";

// Lightweight i18n for the TV client: a context-backed `t()` over the flat
// dictionaries in ./strings.ts. The language is detected once from localStorage or
// the webOS system locale, and can be switched in Settings (persisted). Switching
// re-renders the whole app via context. No i18next dependency — the app is small
// and uses its own React layer (custom useTvInput, no Spotlight).

const STORAGE_KEY = "movora.lang";

function isLang(value: string): value is Lang {
  return (LANGS as readonly string[]).includes(value);
}

// localStorage override → webOS system locale prefix (e.g. "de-DE" → "de") → "en".
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isLang(saved)) return saved;
  } catch {
    /* ignore */
  }
  try {
    const sys = navigator.language.slice(0, 2).toLowerCase();
    if (isLang(sys)) return sys;
  } catch {
    /* ignore */
  }
  return "en";
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`,
  );
}

function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  const table = STRINGS[lang] ?? STRINGS.en;
  const template = table[key] ?? STRINGS.en[key] ?? key;
  return interpolate(template, vars);
}

export type TFunc = (key: Key, vars?: Record<string, string | number>) => string;

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunc;
}

const I18nContext = createContext<I18nValue>({
  lang: "en",
  setLang: () => undefined,
  t: (key, vars) => translate("en", key, vars),
});

export function I18nProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [lang, setLangState] = useState<Lang>(detectLang);

  // Keep the document language in sync (external DOM side-effect, not state).
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (next: Lang): void => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setLangState(next);
  };

  const t: TFunc = (key, vars) => translate(lang, key, vars);

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

export { LANGS, LANG_NAMES } from "./strings";
export type { Key, Lang } from "./strings";
