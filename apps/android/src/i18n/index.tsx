import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {createContext, useContext, useEffect, useMemo, useState} from 'react';
import {NativeModules, Platform} from 'react-native';

import {LANGS, STRINGS, type Key, type Lang} from './strings';

const STORAGE_KEY = 'movora.lang';

function isLang(value: string): value is Lang {
  return (LANGS as readonly string[]).includes(value);
}

// The OS UI language, used until the user picks one (then it's persisted).
function deviceLang(): Lang {
  try {
    let locale = '';
    if (Platform.OS === 'android') {
      locale = (NativeModules.I18nManager?.localeIdentifier as string | undefined) ?? '';
    } else {
      const settings = NativeModules.SettingsManager?.settings;
      locale = settings?.AppleLocale ?? settings?.AppleLanguages?.[0] ?? '';
    }
    const prefix = locale.toLowerCase().split(/[-_]/)[0];
    return isLang(prefix) ? prefix : 'en';
  } catch {
    return 'en';
  }
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`,
  );
}

export type TFunc = (key: Key, vars?: Record<string, string | number>) => string;

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunc;
}

const I18nContext = createContext<I18nValue>({
  lang: 'en',
  setLang: () => undefined,
  t: key => key,
});

// The active UI language, mirrored to a module-level value so the (non-React) API client
// can append ?lang= to read requests for localized metadata.
let activeLang: Lang = 'en';
export function getActiveLang(): Lang {
  return activeLang;
}

export function I18nProvider({children}: {children: React.ReactNode}): React.JSX.Element {
  const [lang, setLangState] = useState<Lang>(deviceLang);

  useEffect(() => {
    activeLang = lang; // keep the API client's ?lang= in sync
  }, [lang]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(saved => {
        if (saved && isLang(saved)) {
          setLangState(saved);
        }
      })
      .catch(() => undefined);
  }, []);

  const value = useMemo<I18nValue>(() => {
    const setLang = (next: Lang): void => {
      setLangState(next);
      void AsyncStorage.setItem(STORAGE_KEY, next);
    };
    const t: TFunc = (key, vars) =>
      interpolate(STRINGS[lang][key] ?? STRINGS.en[key] ?? key, vars);
    return {lang, setLang, t};
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

export {LANGS, LANG_NAMES} from './strings';
export type {Key, Lang} from './strings';
