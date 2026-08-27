/**
 * Writing questions for a topic nobody shipped, and keeping them.
 *
 * ⚠️ **The same rule as the coach applies: there is no key in this file, and
 * there cannot be** (D292). The browser POSTs a topic to a same-origin route
 * and whatever hosts the game holds the Foundry credential. When the route is
 * absent this whole feature is absent, the same way the coach chat is.
 *
 * ⚠️ **Nothing here writes to the question bank.** It fetches rows and hands
 * them back as a grid, so the caller runs them through `previewBank`, the same
 * screen an uploaded spreadsheet goes through, and a person decides. That is
 * not caution for its own sake: this is a certification study tool, and a
 * confidently wrong question is worse than no question because somebody
 * revises the wrong fact and takes it into the exam room.
 */

import { readGeneratedRows, rowsToGrid } from '@fabric-empires/learn';

const GENERATE_ROUTE = 'api/questions';
const BANK_ROUTE = 'api/bank';

export interface SavedBank {
  readonly slug: string;
  readonly topic: string;
  readonly count: number;
  readonly savedAt: string;
}

export interface GenerateResult {
  readonly ok: boolean;
  /** Rows in the shape `previewBank` reads: a header, then one row each. */
  readonly grid: string[][];
  /** Something to show a person when it did not work. */
  readonly error?: string;
}

/**
 * Is there somewhere to save questions?
 *
 * ⚠️ Separate from the coach probe on purpose. Reading and writing a saved
 * bank needs no model at all, so a host with storage and no Foundry deployment
 * should still offer the shelf, even though it cannot write anything new onto
 * it.
 */
export async function bankAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(BANK_ROUTE, {
      headers: { accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return false;
    // An SPA host answering 200 with index.html for an unknown path is not a
    // bank. The same trap the coach probe walks around.
    if (!(response.headers.get('content-type') ?? '').includes('json')) return false;
    const body: unknown = await response.json();
    return (body as { bank?: unknown } | null)?.bank === true;
  } catch {
    return false;
  }
}

/** Everything saved on this host, newest first. */
export async function listBanks(): Promise<readonly SavedBank[]> {
  try {
    const response = await fetch(BANK_ROUTE, { headers: { accept: 'application/json' } });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const banks = (body as { banks?: unknown })?.banks;
    return Array.isArray(banks) ? (banks as SavedBank[]) : [];
  } catch {
    return [];
  }
}

/** Ask for questions on a topic. Returns a grid, saves nothing. */
export async function generateQuestions(
  topic: string,
  count: number,
  context?: string,
): Promise<GenerateResult> {
  try {
    const response = await fetch(GENERATE_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic, count, ...(context ? { context } : {}) }),
    });
    if (!response.ok) {
      return { ok: false, grid: [], error: 'The model could not write questions.' };
    }
    const body: unknown = await response.json();
    const reply = String((body as { reply?: unknown })?.reply ?? '');
    const rows = readGeneratedRows(reply);
    if (rows.length === 0) {
      /*
       * ⚠️ A reply that parses to nothing is reported as nothing, not as a
       * crash and not as an empty success. The model is explicitly told to
       * return fewer questions rather than guess, so zero rows is a possible
       * honest answer and the message says so.
       */
      return { ok: false, grid: [], error: 'The model returned no usable questions. Try a narrower topic.' };
    }
    return { ok: true, grid: rowsToGrid(rows) };
  } catch {
    return { ok: false, grid: [], error: 'The question service could not be reached.' };
  }
}

/** Keep a reviewed grid on the host, so it survives this browser. */
export async function saveBank(
  topic: string,
  grid: readonly (readonly string[])[],
): Promise<{ ok: boolean; saved: number; error?: string }> {
  try {
    const response = await fetch(BANK_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic, rows: grid }),
    });
    if (!response.ok) return { ok: false, saved: 0, error: 'The bank could not be saved.' };
    const body: unknown = await response.json();
    return { ok: true, saved: Number((body as { saved?: unknown })?.saved ?? 0) };
  } catch {
    return { ok: false, saved: 0, error: 'The bank could not be reached.' };
  }
}

/** Fetch a saved bank back as a grid, ready for the same preview. */
export async function loadBank(slug: string): Promise<string[][]> {
  try {
    const response = await fetch(`${BANK_ROUTE}/${encodeURIComponent(slug)}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const rows = (body as { rows?: unknown })?.rows;
    return Array.isArray(rows) ? (rows as string[][]) : [];
  } catch {
    return [];
  }
}
