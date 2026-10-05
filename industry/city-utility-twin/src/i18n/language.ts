/**
 * Which language the app speaks: German or English, decided once at start and switchable live.
 *
 * Precedence, highest first:
 * 1. `?lang=de|en` in the address, so a link can open the app in a known language.
 * 2. The last choice made with the toggle, remembered in this browser.
 * 3. The browser's preferred languages: a German preference gets German, any other gets English.
 * 4. German, when the browser states no preference at all.
 *
 * ⚠️ ONLY THE FIRST BROWSER PREFERENCE COUNTS. A typical German setup lists "de-DE, de, en-US,
 * en", and an English one often still carries German further down. Scanning the whole list for
 * any "de" would show German to people who put English first.
 */

export type Language = 'de' | 'en';

export const LANGUAGES: readonly Language[] = ['de', 'en'];

/** Key in localStorage. Namespaced, because a Fabric App shares its origin with nothing else. */
export const STORAGE_KEY = 'city-utility-twin.lang';

function parse(value: string | null | undefined): Language | null {
  const lower = value?.trim().toLowerCase();
  return lower === 'de' || lower === 'en' ? lower : null;
}

export interface LanguageInputs {
  search: string;
  stored: string | null;
  preferred: readonly string[];
}

export function resolveLanguage({ search, stored, preferred }: LanguageInputs): Language {
  const fromUrl = parse(new URLSearchParams(search).get('lang'));
  if (fromUrl) return fromUrl;
  const remembered = parse(stored);
  if (remembered) return remembered;
  const first = preferred.find((tag) => tag.trim().length > 0);
  if (!first) return 'de';
  return first.trim().toLowerCase().split('-')[0] === 'de' ? 'de' : 'en';
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked (privacy settings, sandboxed frames). Fall back to the browser.
    return null;
  }
}

function initial(): Language {
  if (typeof window === 'undefined') return 'de';
  return resolveLanguage({
    search: window.location.search,
    stored: readStored(),
    preferred: window.navigator.languages?.length
      ? window.navigator.languages
      : [window.navigator.language ?? ''],
  });
}

let current: Language = initial();
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

/** BCP 47 locale for number and time formatting in the current language. */
export function locale(): string {
  return current === 'de' ? 'de-DE' : 'en-GB';
}

/**
 * Switch language, remember the choice and keep the address in step.
 *
 * ⚠️ THE ADDRESS IS UPDATED TOO, not only storage. `?lang=` outranks the stored choice, so a page
 * opened from a `?lang=de` link would otherwise snap back to German on the next reload even
 * though the user has just picked English.
 */
export function setLanguage(next: Language): void {
  if (next === current) return;
  current = next;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered; the address below still carries it for this tab.
    }
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState(window.history.state, '', url);
    document.documentElement.lang = next;
  }
  for (const listener of listeners) listener();
}

export function onLanguageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
