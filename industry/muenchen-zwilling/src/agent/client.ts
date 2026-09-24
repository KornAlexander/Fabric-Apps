/**
 * Client for the agent backend and the coordination notes.
 *
 * ⚠️ THE BACKEND IS A SECOND SERVICE, NOT THE RELAY. The relay brokers read-only open data and is
 * deliberately locked to fixed destinations. This one runs the Foundry tool loop and writes to a
 * Fabric SQL Database, so it lives in its own container app with its own key and its own limits.
 *
 * ⚠️ THE APP KEY IS NOT A SECRET AND MUST NOT BE DESCRIBED AS ONE. It ships inside a public
 * JavaScript bundle, which means anyone who opens the developer tools can read it. Its job is to
 * stop a stranger who finds the URL from running up Foundry tokens. It authenticates nobody, and
 * the backend's own comments say the same thing so the two cannot drift apart.
 *
 * Authorship is separate: see ./token.ts for the Entra access token the backend can verify.
 */

import { token as tokenFor } from './token';

// Aus der Build-Umgebung, siehe UMSETZUNG.md.
const AGENT_ORIGIN = (import.meta.env.VITE_AGENT_ORIGIN ?? '').replace(/\/$/, '');
const APP_KEY = import.meta.env.VITE_AGENT_APP_KEY ?? '';

/** Origins served by the Vite dev proxy rather than by the deployed backend. */
const DEV_ORIGINS = new Set([
  'http://127.0.0.1:5190', 'http://127.0.0.1:4190',
  'http://localhost:5190', 'http://localhost:4190',
]);

function base(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return DEV_ORIGINS.has(origin) ? '/api/agent' : AGENT_ORIGIN;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY, ...extra };
}

/** Who the app believes is signed in. Filled by `setAuthor`; may stay null. */
let reportedAuthor: string | null = null;

/**
 * Record the signed-in user for attribution.
 *
 * ⚠️ REPORTED, NOT PROVEN, AND EVERY LAYER OF THIS FEATURE SAYS SO. Rayfin's browser auth yields
 * a Rayfin session rather than an access token for the backend's audience, so the server cannot
 * independently verify this name. It is a real improvement on a free-text field, and it is still
 * not an audit trail. The column is called `autorGemeldet` and the UI says "gemeldet" for the
 * same reason.
 */
export function setAuthor(name: string | null): void {
  reportedAuthor = name && name.trim() ? name.trim().slice(0, 256) : null;
}

export function author(): string | null {
  return reportedAuthor;
}

function authorHeaders(): Record<string, string> {
  return reportedAuthor ? { 'X-Autor': reportedAuthor } : {};
}

/**
 * Headers for a WRITE: the reported name plus, when one can be obtained silently, an Entra
 * access token the backend can actually verify.
 *
 * ⚠️ THE TOKEN IS AN UPGRADE, NOT A PRECONDITION. If none is available the write still goes out
 * with the reported name and the server decides what to do with it. That keeps a demo working on
 * a machine that has never signed in, while a signed-in user gets a verified author instead of a
 * claimed one. Enforcement lives on the server behind REQUIRE_AUTH, not here.
 */
async function writeHeaders(): Promise<Record<string, string>> {
  const extra = authorHeaders();
  try {
    const bearer = await tokenFor();
    if (bearer) extra.Authorization = `Bearer ${bearer}`;
  } catch {
    // An identity problem must never block a write path that can still succeed without one.
  }
  return headers(extra);
}

// ------------------------------------------------------------------ chat stream

export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'metadata'; provider: string; model: string }
  | { type: 'tool'; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; name: string; summary: string; entwurf?: NoteDraft }
  | { type: 'delta'; text: string }
  | { type: 'done'; rounds: number }
  | { type: 'error'; error: string; message: string };

export interface NoteDraft {
  entwurfId: string;
  kategorie: string;
  text: string;
  baustelle?: { id: string; ort?: string; beginn?: string; ende?: string };
}

/**
 * Stream one question through the agent.
 *
 * ⚠️ NDJSON, PARSED INCREMENTALLY, AND THE PARTIAL LINE IS KEPT. A chunk boundary falls wherever
 * the network puts it, so the last element of a split is usually half an object. Parsing it would
 * throw on perfectly good data; carrying it into the next chunk is the whole trick.
 */
export async function* ask(prompt: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  const response = await fetch(`${base()}/api/assistant/stream`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ prompt }),
    signal,
  });
  if (!response.ok || !response.body) {
    yield { type: 'error', error: 'http', message: `Assistent nicht erreichbar (HTTP ${response.status})` };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed) as AgentEvent;
      } catch {
        // A malformed line is dropped rather than shown: it is a transport fault, not an answer.
      }
    }
  }
}

// ------------------------------------------------------------------ notes

export interface Note {
  notizId: string;
  baustelleId: string;
  ort: string | null;
  easting: number | null;
  northing: number | null;
  kategorie: string;
  text: string;
  zeitraumVon: string | null;
  zeitraumBis: string | null;
  autorGemeldet: string | null;
  quelleKanal: string;
  erstelltAm: string | null;
}

export const KATEGORIEN = [
  'Hinweis',
  'Konflikt vermutet',
  'Eigene Maßnahme geplant',
  'Abstimmung erfolgt',
] as const;

export async function listNotes(signal?: AbortSignal): Promise<{ eintraege: Note[]; verfuegbar: boolean }> {
  const response = await fetch(`${base()}/api/notizen?limit=200`, { headers: headers(), signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function createNote(input: {
  baustelleId: string;
  ort?: string | null;
  easting?: number | null;
  northing?: number | null;
  kategorie: string;
  text: string;
  zeitraumVon?: string | null;
  zeitraumBis?: string | null;
}): Promise<{ ok: boolean; notizId?: string }> {
  const response = await fetch(`${base()}/api/notizen`, {
    method: 'POST',
    headers: await writeHeaders(),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail.slice(0, 200) || `HTTP ${response.status}`);
  }
  return response.json();
}

/** Confirm an agent draft. This is the only path from a model suggestion to a stored row. */
export async function publishDraft(entwurfId: string): Promise<{ ok: boolean; notizId?: string }> {
  const response = await fetch(
    `${base()}/api/notizen/entwurf/${encodeURIComponent(entwurfId)}/speichern`,
    { method: 'POST', headers: await writeHeaders() },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail.slice(0, 200) || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function withdrawNote(notizId: string): Promise<{ ok: boolean }> {
  const response = await fetch(
    `${base()}/api/notizen/${encodeURIComponent(notizId)}/zurueckziehen`,
    { method: 'POST', headers: await writeHeaders() },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
