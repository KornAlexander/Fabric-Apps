/**
 * The consumer API client. Three calls, and none of them takes a subject.
 *
 * ⚠️ THE ABSENCE OF A `key` PARAMETER IS THE FEATURE. `src/api/scheduler.ts` builds
 * `/api/calendar?scope=teacher&key=<id>` because a planner legitimately asks about other people.
 * Nothing here can express that question, so no bug in this file can leak somebody else's week:
 * the server would refuse anyway, but a client that cannot even form the request is one fewer
 * place for the mistake to be made.
 */

import { API_BASE, API_CONFIGURED, getToken, NotSignedIn } from './auth';

export interface Me {
  site: string;
  siteLabel: string;
  teacherId: string;
  displayName: string;
  role: string;
  canPlan: boolean;
  scope: 'self';
}

export interface WeekEntry {
  sessionId: string;
  slotId: string;
  course: string | null;
  kind: string | null;
  cohort: string | null;
  roomId: string | null;
  buildingId: string | null;
  campusId: string | null;
  seats: number | null;
  attendance: number | null;
}

export interface Slot {
  slotId: string;
  day: string;
  dayIndex: number;
  block: number;
  startTime: string;
  endTime: string;
}

export interface Week {
  scope: string;
  subject: { id: string; label?: string; name?: string };
  draftId: string;
  entries: WeekEntry[];
  slots?: Slot[];
  grid?: Slot[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  /*
    ⚠️ REFUSE BEFORE FETCHING, so the reason is the real one. Without this, a build that was never
    told where its API lives sends the request to whatever `API_BASE` happens to be — for a while
    that was a loopback address baked into the public bundle — and the resulting network error is
    reported as a connection failure. That is a true description of what the browser saw and a
    misleading account of what went wrong, which is the worst kind of error message: it is accurate
    enough to be believed and points at the wrong thing.
  */
  if (!API_CONFIGURED) {
    throw new ApiError(
      0,
      'not_configured',
      'Dieser Build kennt die Adresse des Stundenplandienstes nicht (VITE_CONSUMER_API ist nicht gesetzt).'
    );
  }

  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');

  const token = await getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    // The server puts a machine-readable `code` inside `detail` for the refusals a user can act
    // on; anything else is reported by status alone rather than by guessing at prose.
    let code = `http_${response.status}`;
    let message = `Die Anfrage ist fehlgeschlagen (${response.status}).`;
    try {
      const body = await response.json();
      const detail = body?.detail ?? body;
      if (typeof detail === 'string') {
        message = detail;
      } else if (detail && typeof detail === 'object') {
        code = detail.code ?? code;
        message = detail.message ?? message;
      }
    } catch {
      /* a non-JSON error body is not worth a second failure */
    }
    throw new ApiError(response.status, code, message);
  }
  return (await response.json()) as T;
}

export const getMe = (site?: string): Promise<Me> =>
  request<Me>(`/api/me${site ? `?site=${encodeURIComponent(site)}` : ''}`);

export const getMyWeek = (site?: string): Promise<Week> =>
  request<Week>(`/api/me/week${site ? `?site=${encodeURIComponent(site)}` : ''}`);

export interface StreamEvent {
  type: 'metadata' | 'status' | 'tool' | 'tool_result' | 'delta' | 'done' | 'error';
  [key: string]: unknown;
}

/**
 * Stream an answer, yielding each NDJSON event as it arrives.
 *
 * ⚠️ A PARTIAL LINE IS NOT AN EVENT. The buffer below exists because a chunk boundary lands in the
 * middle of a JSON object often enough to matter, and `JSON.parse` on half an object throws inside
 * the read loop, which kills the stream and shows the user nothing.
 */
export async function* askAssistant(
  prompt: string,
  site?: string,
  signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
  // Same refusal as `request`, because this one streams and does not go through it.
  if (!API_CONFIGURED) {
    throw new ApiError(
      0,
      'not_configured',
      'Dieser Build kennt die Adresse des Stundenplandienstes nicht (VITE_CONSUMER_API ist nicht gesetzt).'
    );
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = await getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE}/api/me/assistant`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt, site: site ?? null }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new ApiError(
      response.status,
      `http_${response.status}`,
      'Die Assistenz ist derzeit nicht erreichbar.'
    );
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
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line) as StreamEvent;
      } catch {
        /* a malformed line is skipped rather than ending the stream */
      }
    }
  }
  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer) as StreamEvent;
    } catch {
      /* trailing garbage */
    }
  }
}

export { NotSignedIn };
