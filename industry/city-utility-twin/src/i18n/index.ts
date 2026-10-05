import { getLanguage } from './language';
import { MESSAGES, type MessageArgs, type MessageKey } from './messages';

export { getLanguage, setLanguage, onLanguageChange, locale, resolveLanguage, type Language } from './language';
export type { MessageKey } from './messages';

/** App text in the current language. */
export function t<K extends MessageKey>(key: K, ...args: MessageArgs<K>): string {
  const entry = MESSAGES[key] as unknown as Record<'de' | 'en', (...a: unknown[]) => string>;
  return entry[getLanguage()](...args);
}

/**
 * Text that can be shown in either language.
 *
 * A plain string is a source value and is shown as published. A function is app text and is
 * asked for its wording at the moment it is drawn, so a language switch reaches text that was
 * produced earlier, such as a layer's last status line or a detail panel built at load time.
 */
export type Text = string | (() => string);

export function show(text: Text): string {
  return typeof text === 'function' ? text() : text;
}

/** App text with a German and an English form, for configuration data such as site names. */
export function both(de: string, en: string): () => string {
  return () => (getLanguage() === 'de' ? de : en);
}

/** Lazily translated message, for text produced now and shown later. */
export function later<K extends MessageKey>(key: K, ...args: MessageArgs<K>): () => string {
  return () => t(key, ...args);
}

/** Display label for a note category. The stored value stays the German key the server knows. */
export function categoryLabel(category: string): string {
  const key = `notes.category.${category}` as MessageKey;
  return key in MESSAGES ? t(key as 'notes.category.Hinweis') : category;
}
