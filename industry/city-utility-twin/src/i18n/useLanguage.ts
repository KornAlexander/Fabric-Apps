import { useSyncExternalStore } from 'react';
import { getLanguage, onLanguageChange, type Language } from './language';

/** Re-render the calling component whenever the language changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(onLanguageChange, getLanguage, getLanguage);
}
