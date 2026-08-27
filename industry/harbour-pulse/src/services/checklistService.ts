import { isEmbeddedMode } from '@microsoft/fabric-embedded-host';

import type { NewVesselCheck, VesselCheck } from '@/shared/contract';

import { getRayfinClient, recoverSession } from './rayfinClient';

/**
 * True when running inside the Fabric portal iframe. There the checklist is
 * read/written through the Rayfin backend (GraphQL, using the portal session).
 * Outside Fabric (local dev) there is no authenticated Rayfin session, so a
 * localStorage store keeps the feature usable while developing.
 */
function isFabricEmbedded(): boolean {
  return isEmbeddedMode({});
}

// --- Rayfin-native layer (Fabric portal) ------------------------------------

/**
 * The Fabric handoff mints a session once per page load, so a lapsed session
 * cannot be refreshed by the SDK alone and every call then 401s. Re-run the
 * handoff once and retry before surfacing the failure.
 */
async function withSession<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!/\b401\b|unauthor/i.test((err as Error).message)) throw err;
    if (!(await recoverSession())) {
      throw new Error(
        'Your Fabric session for this app has expired. Reload the page to sign in again.',
      );
    }
    return call();
  }
}

async function fetchChecksRayfin(): Promise<VesselCheck[]> {
  const rows = await withSession(() =>
    getRayfinClient()
      .data.VesselCheck.select([
        'id',
        'ferry_name',
        'category',
        'item',
        'status',
        'notes',
        'inspector',
        'timestamp',
      ])
      .orderBy({ timestamp: 'desc' })
      .execute(),
  );
  return rows.map((r) => ({
    id: String(r.id),
    ferryName: String(r.ferry_name),
    category: r.category as VesselCheck['category'],
    item: String(r.item),
    status: r.status as VesselCheck['status'],
    notes: r.notes ?? undefined,
    inspector: r.inspector ?? undefined,
    ts: new Date(r.timestamp as unknown as string).getTime(),
  }));
}

async function createCheckRayfin(input: NewVesselCheck): Promise<void> {
  await withSession(() =>
    getRayfinClient().data.VesselCheck.create({
      ferry_name: input.ferryName,
      category: input.category,
      item: input.item,
      status: input.status,
      notes: input.notes,
      inspector: input.inspector,
      timestamp: new Date(),
    }),
  );
}

async function deleteCheckRayfin(id: string): Promise<void> {
  await withSession(async () => {
    try {
      await getRayfinClient().data.VesselCheck.delete({ id });
    } catch (err) {
      // The row is gone by this point: the client only fails to read back the
      // deleted record, which DAB does not return to us.
      if (!/failed to extract result/i.test((err as Error).message)) throw err;
    }
  });
}

// --- Local dev layer (localStorage) -----------------------------------------

const LOCAL_KEY = 'vessel-checks';

function readLocal(): VesselCheck[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as VesselCheck[]) : [];
  } catch {
    return [];
  }
}

function fetchChecksLocal(): VesselCheck[] {
  return readLocal().sort((a, b) => b.ts - a.ts);
}

function createCheckLocal(input: NewVesselCheck): void {
  const rows = readLocal();
  rows.push({
    id: crypto.randomUUID(),
    ferryName: input.ferryName,
    category: input.category,
    item: input.item,
    status: input.status,
    notes: input.notes,
    inspector: input.inspector,
    ts: Date.now(),
  });
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
}

function deleteCheckLocal(id: string): void {
  window.localStorage.setItem(
    LOCAL_KEY,
    JSON.stringify(readLocal().filter((c) => c.id !== id)),
  );
}

// --- Public API -------------------------------------------------------------

const changeListeners = new Set<() => void>();

/** Notified whenever a check is logged or removed, from anywhere in the app. */
export function onVesselChecksChanged(cb: () => void): () => void {
  changeListeners.add(cb);
  return () => {
    changeListeners.delete(cb);
  };
}

/** Fetch all logged vessel checks, newest first. */
export async function fetchVesselChecks(): Promise<VesselCheck[]> {
  if (isFabricEmbedded()) return fetchChecksRayfin();
  return fetchChecksLocal();
}

/** Log a new vessel check. */
export async function createVesselCheck(input: NewVesselCheck): Promise<void> {
  if (isFabricEmbedded()) await createCheckRayfin(input);
  else createCheckLocal(input);
  changeListeners.forEach((cb) => cb());
}

/** Permanently remove a logged check. */
export async function deleteVesselCheck(id: string): Promise<void> {
  if (isFabricEmbedded()) await deleteCheckRayfin(id);
  else deleteCheckLocal(id);
  changeListeners.forEach((cb) => cb());
}
