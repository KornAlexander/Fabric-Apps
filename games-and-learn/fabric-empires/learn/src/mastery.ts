/**
 * The learner's mastery of each topic, and where it is kept.
 *
 * Sits between the SM-2 algorithm, which is pure and knows nothing, and the
 * challenge provider, which knows about questions. Its job is to remember
 * what happened last time, which is the only part of spaced repetition that
 * cannot be recomputed.
 *
 * Persistence is behind a tiny interface for two reasons. Tests need a store
 * that does not touch the browser, and the shipped game will eventually keep
 * this per user in Fabric rather than per browser in localStorage. Neither
 * the algorithm nor the provider should have to change when that happens.
 */

import {
  isDue,
  masteryBand,
  newRecord,
  qualityFromScore,
  reviewMastery,
  type DueOptions,
  type MasteryBand,
  type MasteryRecord,
} from './sm2.js';

export interface MasteryStore {
  load(): Record<string, MasteryRecord>;
  save(records: Record<string, MasteryRecord>): void;
}

/** A store that forgets everything, for tests and for a guest session. */
export function memoryStore(seed: Record<string, MasteryRecord> = {}): MasteryStore {
  let held = { ...seed };
  return {
    load: () => ({ ...held }),
    save: (records) => {
      held = { ...records };
    },
  };
}

/**
 * Browser persistence.
 *
 * Deliberately forgiving: a corrupt or unreadable entry means a learner who
 * loses their history, which is bad, but a thrown exception at startup means
 * a learner who cannot play at all, which is worse. Private browsing modes
 * throw on write, so that is caught too.
 */
export function localStorageStore(key = 'fabric-empires:mastery:v1'): MasteryStore {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed as Record<string, MasteryRecord>;
      } catch {
        return {};
      }
    },
    save(records) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(records));
      } catch {
        // Storage unavailable or full. The session still works; only the
        // history between sessions is lost.
      }
    },
  };
}

export interface MasteryTrackerOptions {
  readonly store?: MasteryStore;
  /** When this sitting began, enabling the compressed in-session clock. */
  readonly sessionStart?: number;
  readonly sessionDayMs?: number;
}

export interface TopicMastery {
  readonly topicId: string;
  readonly record: MasteryRecord | undefined;
  readonly band: MasteryBand;
  readonly due: boolean;
}

export interface MasteryTracker {
  /** Record the result of a challenge and reschedule the topic. */
  record(topicId: string, score: number, abandoned: boolean, now?: number): MasteryRecord;
  /** Topic ids that have fallen due, most neglected first. */
  dueTopics(now?: number, among?: readonly string[]): string[];
  get(topicId: string): MasteryRecord | undefined;
  /** Everything known about a set of topics, for the Great Library. */
  report(topicIds: readonly string[], now?: number): TopicMastery[];
  /** Counts by band, for a one-line summary. */
  summary(topicIds: readonly string[]): Record<MasteryBand, number>;
  reset(): void;
}

export function createMasteryTracker(options: MasteryTrackerOptions = {}): MasteryTracker {
  const store = options.store ?? memoryStore();

  /*
   * A store that cannot be read costs the learner their history, which is
   * bad. A store that throws on the way in costs them the game, which is
   * worse. `localStorageStore` already guards itself, but the interface is
   * public and any implementation can fail, so the guard belongs here too.
   */
  let initial: Record<string, MasteryRecord> = {};
  try {
    initial = store.load();
  } catch {
    initial = {};
  }
  const records: Record<string, MasteryRecord> = initial;

  const dueOptions: DueOptions = {
    sessionStart: options.sessionStart,
    sessionDayMs: options.sessionDayMs,
  };

  function persist(): void {
    try {
      store.save(records);
    } catch {
      // Same argument in the other direction: losing the write is survivable,
      // crashing mid-turn is not.
    }
  }

  return {
    record(topicId, score, abandoned, now = Date.now()) {
      const existing = records[topicId] ?? newRecord(topicId);
      const quality = qualityFromScore(score, abandoned);
      const next = reviewMastery(existing, quality, now);
      records[topicId] = next;
      persist();
      return next;
    },

    dueTopics(now = Date.now(), among) {
      /*
       * Only topics that have been seen at least once are returned.
       *
       * An unseen record counts as due inside SM-2, which is right for a
       * flashcard deck where every card has been added deliberately. Here it
       * would mean the entire unresearched tech tree falls due on turn one,
       * so the caller passes the topics that actually exist in the world and
       * this filters to the ones with a history.
       */
      const pool = among ?? Object.keys(records);
      return pool
        .filter((topicId) => {
          const record = records[topicId];
          return record !== undefined && isDue(record, now, dueOptions);
        })
        .sort(
          (a, b) => (records[a]?.lastReviewed ?? 0) - (records[b]?.lastReviewed ?? 0),
        );
    },

    get(topicId) {
      return records[topicId];
    },

    report(topicIds, now = Date.now()) {
      return topicIds.map((topicId) => {
        const record = records[topicId];
        return {
          topicId,
          record,
          band: masteryBand(record),
          due: record !== undefined && isDue(record, now, dueOptions),
        };
      });
    },

    summary(topicIds) {
      const counts: Record<MasteryBand, number> = {
        unseen: 0,
        learning: 0,
        familiar: 0,
        strong: 0,
      };
      for (const topicId of topicIds) {
        counts[masteryBand(records[topicId])] += 1;
      }
      return counts;
    },

    reset() {
      for (const key of Object.keys(records)) delete records[key];
      persist();
    },
  };
}
