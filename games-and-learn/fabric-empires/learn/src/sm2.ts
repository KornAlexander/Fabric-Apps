/**
 * SM-2 spaced repetition.
 *
 * The scheduling half of the learning layer. It knows nothing about the game,
 * nothing about Fabric and nothing about questions: it takes a record, a
 * quality rating and a clock, and returns the next record. That makes it
 * testable on its own, which matters because scheduling bugs are invisible in
 * a single session and only show up weeks later as an item that either never
 * comes back or comes back constantly.
 *
 * The algorithm is Piotr Wozniak's SM-2, which is the one behind most open
 * source flashcard tools. It is old, simple and good enough; the interesting
 * design decisions here are the two around it, namely how a game score maps
 * onto a quality rating and how intervals behave inside a single sitting.
 */

/** One learner's state for one topic. */
export interface MasteryRecord {
  readonly topicId: string;
  /** Consecutive successful reviews. Reset to zero by a lapse. */
  readonly repetitions: number;
  /** SM-2 easiness factor. Never below EASINESS_FLOOR. */
  readonly easiness: number;
  /** Current interval in days. */
  readonly intervalDays: number;
  /** Epoch milliseconds of the last review, or undefined if never reviewed. */
  readonly lastReviewed: number | undefined;
  /** Total reviews attempted, for the Great Library to report honestly. */
  readonly reviews: number;
  /** Reviews that failed, for the same reason. */
  readonly lapses: number;
}

/**
 * The floor on the easiness factor.
 *
 * Without it, an item the learner keeps failing drives its own easiness to
 * zero and then reappears forever, which is the classic way a spaced
 * repetition deck becomes something people abandon.
 */
export const EASINESS_FLOOR = 1.3;
export const DEFAULT_EASINESS = 2.5;

/** SM-2 quality, 0 (blackout) to 5 (perfect). */
export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

/** A quality of 3 or better counts as recalled. */
export const PASS_QUALITY = 3;

export const DAY_MS = 86_400_000;

/**
 * How long a "day" lasts inside one sitting.
 *
 * Real intervals are measured in wall-clock days between sessions, which is
 * correct for learning and useless for a game session: an interval of six
 * days means the mechanic never fires again during the hour somebody actually
 * plays. So a second, compressed clock runs alongside the real one, and an
 * item is due when EITHER has elapsed.
 *
 * This is a deliberate compromise and worth naming as one. The compressed
 * clock exists so the player sees the loop work; the real clock is the one
 * that does the teaching.
 */
export const SESSION_DAY_MS = 75_000;

export function newRecord(topicId: string): MasteryRecord {
  return {
    topicId,
    repetitions: 0,
    easiness: DEFAULT_EASINESS,
    intervalDays: 0,
    lastReviewed: undefined,
    reviews: 0,
    lapses: 0,
  };
}

/**
 * Map a challenge score onto an SM-2 quality.
 *
 * The game scores -1 to +1 and SM-2 wants 0 to 5, so something has to bridge
 * them, and the bridge is a judgement rather than arithmetic. The important
 * boundary is at 3: below it the item is treated as forgotten and its
 * interval collapses. A slow but correct answer therefore has to land on 3 or
 * above, because "I got there in the end" is recall, not failure.
 */
export function qualityFromScore(score: number, abandoned = false): ReviewQuality {
  if (abandoned) return 0;
  if (score >= 0.9) return 5;
  if (score >= 0.5) return 4;
  if (score >= 0) return 3;
  if (score >= -0.7) return 2;
  return 1;
}

/**
 * Apply a review and return the updated record.
 *
 * Pure: the caller supplies the clock, so tests do not have to wait and a
 * replay is reproducible.
 */
export function reviewMastery(
  record: MasteryRecord,
  quality: ReviewQuality,
  now: number,
): MasteryRecord {
  const passed = quality >= PASS_QUALITY;

  // The standard SM-2 easiness update. Note it runs on failures too, so a
  // repeatedly missed item becomes permanently harder and comes back sooner
  // even after it starts passing again.
  const adjusted =
    record.easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  const easiness = Math.max(EASINESS_FLOOR, Number(adjusted.toFixed(4)));

  if (!passed) {
    // A lapse resets the ladder rather than merely shortening it. Half
    // remembering an item is not the same as knowing it, and SM-2 is
    // deliberately unsentimental about that.
    return {
      ...record,
      repetitions: 0,
      intervalDays: 1,
      easiness,
      lastReviewed: now,
      reviews: record.reviews + 1,
      lapses: record.lapses + 1,
    };
  }

  const repetitions = record.repetitions + 1;
  const intervalDays =
    repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(record.intervalDays * easiness);

  return {
    ...record,
    repetitions,
    intervalDays: Math.max(1, intervalDays),
    easiness,
    lastReviewed: now,
    reviews: record.reviews + 1,
    lapses: record.lapses,
  };
}

/**
 * Epoch milliseconds at which this record next falls due, on the real clock.
 *
 * ⚠️ **The real clock only.** This deliberately ignores the compressed session
 * clock above, so an interval of one day reports as twenty four hours away
 * rather than as seventy five seconds. Anything asking "is this due *now*, in
 * this sitting" wants `isDue`, which takes `sessionStart` and honours both.
 *
 * Named because measuring the loop through this function makes a working
 * feature look broken: an item that the game will re-ask two minutes into a
 * session reports here as due tomorrow, and both numbers are correct.
 */
export function dueAt(record: MasteryRecord): number {
  if (record.lastReviewed === undefined) return 0;
  return record.lastReviewed + record.intervalDays * DAY_MS;
}

export interface DueOptions {
  /**
   * When the current sitting began. Supplying it enables the compressed
   * in-session clock; leaving it out uses real days only.
   */
  readonly sessionStart?: number | undefined;
  readonly sessionDayMs?: number | undefined;
}

/**
 * Is this record due for review?
 *
 * A record that has never been reviewed is due immediately: the first time a
 * topic is researched is exactly when it should first be tested.
 */
export function isDue(record: MasteryRecord, now: number, options: DueOptions = {}): boolean {
  if (record.lastReviewed === undefined) return true;
  if (now >= dueAt(record)) return true;

  const { sessionStart, sessionDayMs = SESSION_DAY_MS } = options;
  if (sessionStart === undefined) return false;

  // Compressed clock: measured from the later of the session start and the
  // last review, so an item reviewed five minutes ago does not immediately
  // reappear just because the session has been running a while.
  const from = Math.max(sessionStart, record.lastReviewed);
  return now - from >= record.intervalDays * sessionDayMs;
}

/** Records that are due, oldest first, so the most neglected comes back first. */
export function dueRecords(
  records: Iterable<MasteryRecord>,
  now: number,
  options: DueOptions = {},
): MasteryRecord[] {
  return [...records]
    .filter((record) => isDue(record, now, options))
    .sort((a, b) => (a.lastReviewed ?? 0) - (b.lastReviewed ?? 0));
}

/** A coarse mastery band, for display in the Great Library. */
export type MasteryBand = 'unseen' | 'learning' | 'familiar' | 'strong';

export function masteryBand(record: MasteryRecord | undefined): MasteryBand {
  if (!record || record.lastReviewed === undefined) return 'unseen';
  if (record.repetitions >= 4 && record.intervalDays >= 21) return 'strong';
  if (record.repetitions >= 2) return 'familiar';
  return 'learning';
}

/**
 * A band as a number between 0 and 1.
 *
 * ⚠️ **The only place the four bands are given a size**, so that anything
 * asking "how well is this known" gets the same answer. The engine cannot use
 * the bands themselves: it must not know what a mastery band is, or what a
 * certification is, so it takes a plain number for an opaque topic id (D35).
 * This is the function that converts between the two worlds.
 *
 * The values are spaced so that the thresholds a caller writes read the way
 * the design is spoken about: above 0.3 means "at least learning", above 0.6
 * means "at least familiar", above 0.95 means "strong".
 */
export const BAND_STRENGTH: Readonly<Record<MasteryBand, number>> = Object.freeze({
  unseen: 0,
  learning: 0.34,
  familiar: 0.67,
  strong: 1,
});

export function bandStrength(record: MasteryRecord | undefined): number {
  return BAND_STRENGTH[masteryBand(record)];
}
