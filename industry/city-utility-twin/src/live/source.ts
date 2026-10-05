/**
 * Shared plumbing for every live source.
 *
 * ⚠️ ONE RULE RUNS THROUGH THIS WHOLE DIRECTORY: nothing in it may invent a value. If a source is
 * unreachable the layer says so and draws nothing. There is no sample data, no last-known replay
 * and no plausible filler anywhere in `src/live`, because the entire point of these layers in
 * front of four data owners is that what is on the map is what the source actually published.
 */

import { later, locale, t, type Text } from '../i18n';
import type { DataMode } from './dataMode';

export type LiveState = 'idle' | 'loading' | 'live' | 'error';

export interface LiveStatus {
  state: LiveState;
  /**
   * User-facing, short enough for the layer panel. App wording is passed as a function so the
   * panel can redraw it in the other language without waiting for the next poll.
   */
  text: Text;
  /** When the displayed data was fetched. Null while nothing has been fetched. */
  fetchedAt: Date | null;
  /**
   * When the newest drawn data was observed, where the source publishes that (a measuring hour,
   * a sensor's reading time). Absent means only the fetch time is known; the badge then shows it.
   */
  observedAt?: Date | null;
  /**
   * `computed` when `fetchedAt` is when the app computed the drawing from data it already had
   * (vehicle positions from the planned service), not a fetch. The badge then says so.
   */
  timeBasis?: 'fetched' | 'computed';
  /**
   * Overrides the layer's usual data mode for this status, when the source delivered less than the
   * layer normally draws (MVG answering with planned times only is not a measurement).
   */
  dataMode?: DataMode;
  /** How many features are currently drawn. */
  count: number;
}

export type StatusReporter = (status: LiveStatus) => void;

/**
 * An error whose message is app text. `describeError` asks it for its wording at display time,
 * so a failure reported in German reads in English after a switch, like every other line.
 */
export class TextError extends Error {
  constructor(readonly text: () => string) {
    super(text());
  }
}

export function idleStatus(): LiveStatus {
  return { state: 'idle', text: later('layer.off'), fetchedAt: null, count: 0 };
}

/** `14:07` in local time — the label that turns "live" from a claim into a checkable one. */
export function clock(at: Date): string {
  return at.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hour12: false });
}

export interface FetchJsonOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Bytes. A response larger than this is refused rather than parsed. */
  maxBytes?: number;
}

/** Whether a URL is the app's own origin (relative URLs are). */
export function sameOrigin(url: string): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

/**
 * Fetch and parse JSON with a timeout and a size ceiling.
 *
 * ⚠️ THE TIMEOUT IS NOT OPTIONAL POLISH. These are public services with no SLA, and a fetch that
 * never settles leaves a toggle stuck on "lädt" for the rest of the session with no way to tell
 * whether it is slow or dead. A visible failure after 12 seconds is worth far more than an
 * invisible wait.
 *
 * ⚠️ `AbortSignal.any` composes the caller's signal with the timeout so that disposing the layer
 * cancels the request as well. Aborting only on the timeout would leave a disposed layer's
 * response arriving later and writing into a scene that no longer exists.
 *
 * ⚠️ `maxBytes` IS A REJECTION, NOT A STREAMING BOUND, and the difference matters. The declared
 * `content-length` is checked before reading, which is what actually protects against a huge
 * response — but a chunked reply has no such header, and the body is then fully buffered before
 * the second check can reject it. The second check also measures characters rather than bytes,
 * so it is conservative for ASCII and lenient for multi-byte text. Both are acceptable here
 * because every endpoint is a known open-data service returning tens to hundreds of kilobytes;
 * they would not be acceptable against an arbitrary URL.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 12000;
  const maxBytes = options.maxBytes ?? 8_000_000;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  const response = await fetch(url, {
    signal,
    // ⚠️ NO CREDENTIALS TO A THIRD-PARTY ENDPOINT, EVER, but the app's OWN files need the session:
    // the hosted app serves its assets (the baked service data) only to signed-in users, so a
    // same-origin request without the cookie is refused with 401. Same rule as the terrain reader.
    credentials: sameOrigin(url) ? 'same-origin' : 'omit',
    referrerPolicy: 'no-referrer',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    throw new TextError(later('error.tooLargeBytes', declared));
  }
  const text = await response.text();
  if (text.length > maxBytes) {
    throw new TextError(later('error.tooLarge'));
  }
  return JSON.parse(text) as T;
}

/**
 * Turn an exception into something a person standing in front of the map can act on.
 *
 * ⚠️ A CORS REJECTION AND A DEAD SERVICE LOOK IDENTICAL TO `fetch`. The browser reports both as
 * an opaque `TypeError: Failed to fetch`, deliberately, so that a page cannot probe a network it
 * is not allowed to see. This app is very likely to meet exactly that case when hosted inside
 * Fabric, so the message names the possibility instead of blaming the source.
 */
export function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return t('error.timeout');
  if (error instanceof DOMException && error.name === 'AbortError') return t('error.aborted');
  if (error instanceof TypeError) return t('error.unreachable');
  if (error instanceof TextError) return error.text();
  if (error instanceof Error) return error.message;
  return t('error.unknown');
}

/** "<what> <why>" as a status line that follows the language, e.g. "Baustellen Zeitüberschreitung". */
export function failure(what: () => string, error: unknown): () => string {
  return () => t('error.prefixed', what(), describeError(error));
}
