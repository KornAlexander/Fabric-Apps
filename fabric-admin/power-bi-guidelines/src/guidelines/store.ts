/**
 * Where the team's answers live: this browser's `localStorage`, under one
 * key. Nothing leaves the browser except as a file the person exports.
 *
 * Both what is read back from storage and what an imported file holds are
 * untrusted: everything goes through `readConventions`, which keeps only
 * known questions, offered choices and bounded text.
 */
import { readConventions, toStored, type Conventions } from './conventions';
import type { Answer } from './questions';

export const STORAGE_KEY = 'power-bi-guidelines.conventions';

/** Marks an exported file as ours. */
export const FILE_KIND = 'power-bi-guidelines.conventions';

/** Fifty answers of at most 500 characters fit many times over. */
export const MAX_IMPORT_BYTES = 256 * 1024;

export interface ConventionsStore {
  /** The stored value as it is, `undefined` when nothing is stored. Throws when storage cannot be read. */
  read(): Promise<unknown>;
  /** `false` when the browser refused to keep it. */
  write(value: unknown): Promise<boolean>;
  /** `false` when this browser does not let the page keep anything. */
  available(): boolean;
}

function storage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    // Some browsers throw on the mere access when site data is blocked.
    return null;
  }
}

/** The store over this browser's `localStorage`. */
export function browserStore(key = STORAGE_KEY): ConventionsStore {
  return {
    async read() {
      const s = storage();
      if (!s) throw new Error('storage unavailable');
      const raw = s.getItem(key);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        // Damaged: something is there and it cannot be read.
        return raw;
      }
    },
    async write(value) {
      const s = storage();
      if (!s) return false;
      try {
        s.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    available() {
      const s = storage();
      if (!s) return false;
      try {
        const probe = `${key}.probe`;
        s.setItem(probe, '1');
        s.removeItem(probe);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Stored or imported answers as conventions. Nobody signs in here, so a
 * "saved by" in a file is somebody's claim, not an attribution: it is dropped.
 */
export function readLocal(raw: unknown): Conventions {
  const { updatedBy: _by, ...conventions } = readConventions(raw);
  return conventions;
}

/** What a saved answer set looks like before it is written. */
export function toSaved(answers: Record<string, Answer>, now: Date) {
  // Nobody is signed in, so there is no "who".
  const { updatedBy: _by, ...rest } = toStored(answers, '', now);
  return rest;
}

/** The file a team passes around: the kind, a version, the cleaned answers and when. */
export function exportText(answers: Record<string, Answer>, now: Date): string {
  return `${JSON.stringify({ kind: FILE_KIND, ...toSaved(answers, now) }, null, 2)}\n`;
}

export function exportFileName(now: Date): string {
  return `power-bi-guidelines-conventions-${now.toISOString().slice(0, 10)}.json`;
}

export type ImportResult = { ok: true; conventions: Conventions } | { ok: false; reason: 'tooLarge' | 'notJson' | 'empty' };

/** Reads an imported file's text. Only answers to known questions survive. */
export function parseImport(text: string): ImportResult {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, reason: 'tooLarge' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'notJson' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'notJson' };
  const file = raw as Record<string, unknown>;
  // Ours, or the Power BI Fixer's `{ answers, completed }`: both keep the answers
  // under `answers`. Any other JSON is not read as answers.
  if (!file.answers || typeof file.answers !== 'object' || Array.isArray(file.answers)) return { ok: false, reason: 'notJson' };
  const conventions = readLocal(file);
  if (Object.keys(conventions.answers).length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, conventions };
}

/** A chosen file's text. `FileReader`, because older engines lack `Blob.text()`. */
export function readFileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('unreadable file'));
    reader.readAsText(file);
  });
}

/** Hands the browser a file to save. */
export function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Some browsers start the download only after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}