import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import de from './de.json';
import en from './en.json';

export type Locale = 'de' | 'en';

/** Realtime voice per locale — PLAN §14 Q5: one switch drives UI language *and* assistant voice. */
export const VOICE_BY_LOCALE: Record<Locale, string> = {
  de: 'de-DE-SeraphinaMultilingualNeural',
  en: 'en-US-AndrewMultilingualNeural',
};

const BUNDLES = { de, en } as const;

type Bundle = typeof de;

function lookup(bundle: Bundle, path: string): string {
  const value = path
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], bundle);
  return typeof value === 'string' ? value : path;
}

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Translate a dotted key, optionally interpolating `{{name}}` placeholders. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  voice: string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('de');

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let text = lookup(BUNDLES[locale], key);
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replaceAll(`{{${name}}}`, String(value));
        }
      }
      return text;
    },
    [locale]
  );

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t, voice: VOICE_BY_LOCALE[locale] }),
    [locale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
