import { useCallback, useMemo } from 'react';

import { useI18n as useTwinI18n } from '../../i18n/I18nProvider';
import de from './de.json';
import en from './en.json';

/**
 * The Caldova order screens' own catalogue (the `reorder` part of Caldova Köln's de/en.json), driven
 * by the twin's DE/EN switch instead of a provider of its own (D51).
 */
export type Locale = 'de' | 'en';

const BUNDLES = { de, en } as const;

function lookup(bundle: typeof de, path: string): string {
  const value = path
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], bundle);
  return typeof value === 'string' ? value : path;
}

export function useI18n() {
  const { lang: locale, setLang: setLocale } = useTwinI18n();
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let text = lookup(BUNDLES[locale], key);
      if (vars) {
        for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{{${name}}}`, String(value));
      }
      return text;
    },
    [locale]
  );
  return useMemo(() => ({ locale: locale as Locale, setLocale, t }), [locale, setLocale, t]);
}
