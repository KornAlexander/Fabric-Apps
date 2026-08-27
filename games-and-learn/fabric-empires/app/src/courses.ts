/**
 * Courses somebody brought with them.
 *
 * Kept beside the shipped campaigns rather than inside them, because they are
 * different in one way that matters: a shipped campaign is checked by a test
 * and an imported one is whatever was in the file. Everything downstream still
 * treats them identically, since `buildImportedCampaign` produces a real
 * `Campaign` with real hashed answers, but the two lists are stored apart so a
 * bad import can be dropped without touching anything that was built here.
 *
 * ⚠️ **Persisted whole, questions included.** The alternative is remembering
 * the file name and asking for the file again, which is what most of these
 * features do and is why most of them get used once. A reload should not lose
 * somebody's curriculum.
 */

import { CAMPAIGNS, type Campaign } from '@fabric-empires/learn';

const STORE_KEY = 'fabric-empires:courses:v1';

let imported: Campaign[] = load();

function load(): Campaign[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Shallow shape check only. A file that was valid when it was imported
    // stays valid, and anything that has been hand-edited in storage is the
    // editor's problem, not something to try to repair here.
    return parsed.filter(
      (c): c is Campaign =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as Campaign).id === 'string' &&
        Array.isArray((c as Campaign).questions),
    );
  } catch {
    return [];
  }
}

function save(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(imported));
  } catch {
    // Storage full or refused. The course still works for this session, which
    // is better than refusing the import over a thing the player cannot fix.
  }
}

/** Everything selectable: what shipped, then what was brought. */
export function allCampaigns(): readonly Campaign[] {
  return [...CAMPAIGNS, ...imported];
}

/** Add one, replacing any earlier import with the same id. */
export function addImportedCampaign(campaign: Campaign): void {
  imported = [...imported.filter((c) => c.id !== campaign.id), campaign];
  save();
}

export function importedCampaigns(): readonly Campaign[] {
  return imported;
}

export function forgetImportedCampaigns(): void {
  imported = [];
  save();
}
