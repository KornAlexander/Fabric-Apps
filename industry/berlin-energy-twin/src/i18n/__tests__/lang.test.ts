import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialLang } from '../I18nProvider'

/**
 * ⚠️ THE APP COULD OPEN IN ENGLISH IN FRONT OF A GERMAN OPERATOR.
 *
 * The default used to follow `navigator.language`, so on an English-locale
 * laptop - which is what this demo is driven from - the first screen a German
 * municipal transport operator saw was in English, about their own network.
 * Small, but a real credibility tax, and the subject matter is German anyway
 * (Zahnradbahn, Standseilbahn, Betriebshof).
 */

function stubStorage(stored: string | null) {
  vi.stubGlobal('localStorage', {
    getItem: () => stored,
    setItem: () => {},
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('initial language', () => {
  it('opens in German when nothing has been chosen', () => {
    stubStorage(null)
    vi.stubGlobal('navigator', { language: 'en-GB' })
    expect(initialLang()).toBe('de')
  })

  it('ignores the browser language entirely', () => {
    stubStorage(null)
    for (const language of ['en-US', 'fr-FR', 'de-DE', 'en']) {
      vi.stubGlobal('navigator', { language })
      expect(initialLang(), language).toBe('de')
    }
  })

  it('still honours an explicit choice, in both directions', () => {
    stubStorage('en')
    expect(initialLang()).toBe('en')
    stubStorage('de')
    expect(initialLang()).toBe('de')
  })

  it('falls back to German on a junk stored value', () => {
    stubStorage('klingon')
    expect(initialLang()).toBe('de')
  })
})
