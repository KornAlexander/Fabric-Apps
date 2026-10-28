import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { STRINGS, type Lang, type StringKey } from './strings'

const STORAGE_KEY = 'bsw-twin-lang'

/**
 * German unless the visitor has chosen otherwise.
 *
 * ⚠️ This used to follow `navigator.language`, which meant the app could open
 * in English on an English-locale laptop - in front of a German municipal
 * operator, in a demo about their own network. That is a small but real
 * credibility tax, and the subject matter is German anyway (Zahnradbahn,
 * Standseilbahn, Betriebshof). English stays one click away and, once chosen,
 * is remembered.
 */
export function initialLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'de' || stored === 'en') return stored
  return 'de'
}

type Ctx = {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: StringKey) => string
}

const I18nContext = createContext<Ctx | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    localStorage.setItem(STORAGE_KEY, l)
    document.documentElement.lang = l
  }, [])

  const t = useCallback((key: StringKey) => STRINGS[lang][key], [lang])

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
