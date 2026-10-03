/**
 * What the game remembers about itself, after the tab is closed.
 *
 * ⚠️ **Nothing here is allowed to affect play.** Every function returns void,
 * swallows its own failures, and never blocks. A statistics write that could
 * throw into a battle would mean losing a fight because a token expired, which
 * is a far worse defect than having no statistics at all. The presenter hook
 * this feeds is wrapped for the same reason, in the other layer, on purpose:
 * neither end trusts the other to be careful.
 *
 * ⚠️ **It is OFF unless the app was built against a Rayfin backend**, and that
 * is a deliberate property rather than a limitation. The public GitHub Pages
 * copy is a static site with no data service and nobody signed in, so there is
 * no session to attribute a row to and no endpoint to send it to. Baking the
 * tenant's API URL into that public bundle to no purpose would also put a
 * `*.pbidedicated.windows.net` address into a public artefact, which is the
 * exact shape `verify_publishable.py` exists to keep out of the tree.
 *
 * So this degrades exactly the way missing media does: the public build simply
 * does not record, and nothing anywhere reports an error.
 */

import { RayfinClient } from '@microsoft/rayfin-client';
import type { AttemptRecord } from '@fabric-empires/learn';

/** The two tables, as declared in `rayfin/data/`. */
interface StatsSchema {
  GameResult: {
    id: string;
    userId: string;
    userName?: string;
    seed: string;
    difficulty: string;
    players: number;
    outcome: string;
    turns: number;
    cities: number;
    readinessPercent: number;
    skillsResearched: number;
    cheatsUsed?: string;
    startedAt: Date;
    endedAt: Date;
    durationSeconds: number;
  };
  QuestionAttempt: {
    id: string;
    userId: string;
    gameId: string;
    topicId: string;
    questionId: string;
    correct: boolean;
    context: string;
    seconds: number;
    seat: number;
    courseId: string;
    askedAt: Date;
  };
}

const env = (...names: string[]): string => {
  for (const name of names) {
    const value = (import.meta.env as Record<string, string | undefined>)[name];
    if (value) return value;
  }
  return '';
};

const BASE_URL = env('VITE_RAYFIN_API_URL', 'VITE_API_URL');
const PUBLISHABLE_KEY = env('VITE_RAYFIN_PUBLISHABLE_KEY', 'VITE_PUBLISHABLE_KEY');

/** Whether this build has somewhere to write at all. */
export const statsConfigured = (): boolean => Boolean(BASE_URL && PUBLISHABLE_KEY);

let client: RayfinClient<StatsSchema> | undefined;
function getClient(): RayfinClient<StatsSchema> | undefined {
  if (!statsConfigured()) return undefined;
  if (!client) {
    client = new RayfinClient<StatsSchema>({
      baseUrl: BASE_URL,
      publishableKey: PUBLISHABLE_KEY,
    });
  }
  return client;
}

/**
 * The signed-in player, or nothing.
 *
 * ⚠️ **Never triggers an interactive sign-in.** Rayfin's Fabric sign-in can
 * end in `window.open`, which a browser only permits inside a user gesture,
 * and there is no gesture to spend here: this is called after a question the
 * player answered with the keyboard. A silent session (already signed in, or
 * the postMessage handoff when running inside the Fabric portal) is the only
 * one worth having for recording. No session simply means no row.
 */
function identity(): { id: string; name?: string } | undefined {
  const c = getClient();
  if (!c) return undefined;
  try {
    const user = (c as unknown as { auth?: { currentUser?: { id?: string; email?: string } } })
      .auth?.currentUser;
    if (!user?.id) return undefined;
    return user.email ? { id: user.id, name: user.email } : { id: user.id };
  } catch {
    return undefined;
  }
}

/**
 * The current campaign, as far as the stats are concerned.
 *
 * ⚠️ A game id is minted here rather than taken from the save, because the
 * save has no id: it is "the one game", overwritten in place. Attempts carry
 * this so they can be grouped by campaign even when that campaign is abandoned
 * and never writes a `GameResult` row at all, which is the common case.
 */
let gameId = crypto.randomUUID();
let startedAt = new Date();

export function beginRun(): void {
  gameId = crypto.randomUUID();
  startedAt = new Date();
  queue.length = 0;
}

export const currentRunId = (): string => gameId;

/*
 * Attempts are queued and flushed in batches.
 *
 * ⚠️ One HTTP round trip per question would put a network call inside the
 * loop between answering and the blow landing. Even fire-and-forget, that is
 * a request every few seconds for an hour. The queue costs a little memory and
 * means a normal session writes a handful of times instead of hundreds.
 */
const queue: StatsSchema['QuestionAttempt'][] = [];
const FLUSH_AT = 8;

export function recordAttempt(
  attempt: AttemptRecord,
  meta: { seat: number; courseId: string },
): void {
  const who = identity();
  if (!who) return;
  queue.push({
    id: crypto.randomUUID(),
    userId: who.id,
    gameId,
    topicId: attempt.topicId,
    questionId: attempt.questionId,
    correct: attempt.correct,
    context: attempt.kind.slice(0, 16),
    seconds: Math.round(attempt.thinkingMs / 1000),
    seat: meta.seat,
    courseId: meta.courseId.slice(0, 64),
    askedAt: new Date(),
  });
  if (queue.length >= FLUSH_AT) void flush();
}

export async function flush(): Promise<void> {
  const c = getClient();
  if (!c || queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    for (const row of batch) await c.data.QuestionAttempt.create(row);
  } catch (err) {
    // ⚠️ Dropped, not retried and not re-queued. A retry loop on a broken
    // token would grow without bound for an hour and then post a burst of
    // stale rows. Losing a few attempts is the cheaper failure.
    console.warn('stats: attempts not recorded', err);
  }
}

export interface RunSummary {
  readonly seed: string;
  readonly difficulty: string;
  readonly players: number;
  readonly outcome: 'victory' | 'defeat' | 'abandoned';
  readonly turns: number;
  readonly cities: number;
  readonly readinessPercent: number;
  readonly skillsResearched: number;
  readonly cheatsUsed: readonly string[];
}

export async function recordRun(summary: RunSummary): Promise<void> {
  const c = getClient();
  const who = identity();
  if (!c || !who) return;
  const endedAt = new Date();
  try {
    // Attempts first: if only one of the two writes survives, the evidence is
    // worth more than the summary.
    await flush();
    await c.data.GameResult.create({
      id: gameId,
      userId: who.id,
      ...(who.name ? { userName: who.name } : {}),
      seed: summary.seed.slice(0, 64),
      difficulty: summary.difficulty.slice(0, 32),
      players: summary.players,
      outcome: summary.outcome,
      turns: summary.turns,
      cities: summary.cities,
      readinessPercent: Math.round(summary.readinessPercent),
      skillsResearched: summary.skillsResearched,
      ...(summary.cheatsUsed.length
        ? { cheatsUsed: summary.cheatsUsed.join(',').slice(0, 400) }
        : {}),
      startedAt,
      endedAt,
      durationSeconds: Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)),
    });
  } catch (err) {
    console.warn('stats: run not recorded', err);
  }
}
