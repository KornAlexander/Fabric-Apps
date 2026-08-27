/**
 * Which edition is running, and how the coach talks to a model.
 *
 * Two editions ship from one codebase, which is already the plan (D37, D38):
 * a Fabric App on capacity as the primary URL, and a static build that works
 * when the capacity is paused or absent.
 *
 * ## ⚠️ There is no API key in this file, and there never can be
 *
 * A static page cannot hold a secret. Anything shipped in the bundle is
 * readable by anyone who opens the app, so an Azure AI Foundry key placed here
 * would be a published key, and this repository is headed for public.
 *
 * So the connected edition calls a **same-origin route**, `api/coach`, and
 * whatever hosts it holds the credential and forwards the request. That is a
 * Fabric App backend, a Container App, or a Function: this side does not care
 * which, and cannot be made to leak one.
 *
 * When the route is not there, `probe()` fails and the edition is `standalone`.
 * Nothing breaks and nothing is logged as an error, the same shape as the
 * optional anthem (D258): the feature is absent rather than broken.
 */

const COACH_ROUTE = 'api/coach';

export type Edition = 'standalone' | 'capacity';

export interface CoachReply {
  readonly ok: boolean;
  readonly text: string;
}

let known: Edition | undefined;

/**
 * Ask the host whether a coach is available.
 *
 * ⚠️ A GET rather than a HEAD, and it expects a small JSON body. Some static
 * hosts answer HEAD for every path and answer 200 for an unknown one by
 * serving `index.html`, so "the route replied" is not evidence the route
 * exists. Requiring a JSON object with a known field is.
 */
export async function probeEdition(signal?: AbortSignal): Promise<Edition> {
  if (known) return known;
  try {
    const response = await fetch(COACH_ROUTE, {
      method: 'GET',
      headers: { accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      known = 'standalone';
      return known;
    }
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('json')) {
      // An SPA host serving index.html for an unknown path. Not a coach.
      known = 'standalone';
      return known;
    }
    const body: unknown = await response.json();
    const ready =
      typeof body === 'object' && body !== null && (body as { coach?: unknown }).coach === true;
    known = ready ? 'capacity' : 'standalone';
  } catch {
    known = 'standalone';
  }
  return known;
}

/** What was decided, without asking again. Standalone until proven otherwise. */
export function edition(): Edition {
  return known ?? 'standalone';
}

/**
 * Ask the coach a question.
 *
 * The digest goes with every turn rather than being remembered server-side,
 * because the learner's progress changes between messages and a coach quoting
 * a number from two minutes ago is worse than one that says it does not know.
 */
export async function askCoach(
  question: string,
  digest: string,
  history: readonly { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<CoachReply> {
  try {
    const response = await fetch(COACH_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, digest, history: history.slice(-6) }),
    });

    if (!response.ok) {
      return { ok: false, text: `The coach is not answering (HTTP ${response.status}).` };
    }

    const body: unknown = await response.json();
    const text =
      typeof body === 'object' && body !== null && typeof (body as { reply?: unknown }).reply === 'string'
        ? (body as { reply: string }).reply
        : '';

    return text
      ? { ok: true, text }
      : { ok: false, text: 'The coach replied with nothing.' };
  } catch (error) {
    console.error('Coach request failed', error);
    return { ok: false, text: 'The coach could not be reached.' };
  }
}
