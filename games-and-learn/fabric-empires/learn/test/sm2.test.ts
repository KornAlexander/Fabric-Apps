import { describe, it, expect } from 'vitest';
import {
  DAY_MS,
  DEFAULT_EASINESS,
  EASINESS_FLOOR,
  createMasteryTracker,
  dueAt,
  isDue,
  masteryBand,
  memoryStore,
  newRecord,
  qualityFromScore,
  reviewMastery,
  type MasteryRecord,
} from '../src/index.js';

const T0 = 1_700_000_000_000;

/** Pass a record n times in a row, one interval apart. */
function passTimes(record: MasteryRecord, times: number, quality: 4 | 5 = 4): MasteryRecord {
  let current = record;
  let now = T0;
  for (let i = 0; i < times; i++) {
    current = reviewMastery(current, quality, now);
    now += current.intervalDays * DAY_MS;
  }
  return current;
}

describe('the SM-2 schedule', () => {
  it('treats a never reviewed topic as due, so a new skill is tested at once', () => {
    expect(isDue(newRecord('t'), T0)).toBe(true);
  });

  it('walks the standard interval ladder on success', () => {
    // 1 day, then 6, then interval times easiness. Getting this ladder wrong
    // is invisible for a week and then obvious forever.
    let record = reviewMastery(newRecord('t'), 4, T0);
    expect(record.intervalDays).toBe(1);

    record = reviewMastery(record, 4, T0 + DAY_MS);
    expect(record.intervalDays).toBe(6);

    const before = record.intervalDays;
    record = reviewMastery(record, 4, T0 + 7 * DAY_MS);
    expect(record.intervalDays).toBe(Math.round(before * record.easiness));
  });

  it('collapses the interval on a lapse rather than merely shortening it', () => {
    const strong = passTimes(newRecord('t'), 4);
    expect(strong.intervalDays).toBeGreaterThan(6);

    const lapsed = reviewMastery(strong, 1, T0 + 100 * DAY_MS);
    expect(lapsed.repetitions).toBe(0);
    expect(lapsed.intervalDays).toBe(1);
    expect(lapsed.lapses).toBe(strong.lapses + 1);
  });

  it('never lets easiness fall below the floor', () => {
    // Without the floor a repeatedly failed item returns forever, which is
    // how a review deck becomes something people abandon.
    let record = newRecord('t');
    for (let i = 0; i < 20; i++) record = reviewMastery(record, 0, T0 + i * DAY_MS);
    expect(record.easiness).toBeGreaterThanOrEqual(EASINESS_FLOOR);
  });

  it('makes a hard item permanently harder, even after it starts passing', () => {
    const struggled = reviewMastery(newRecord('t'), 3, T0);
    const easy = reviewMastery(newRecord('t'), 5, T0);
    expect(struggled.easiness).toBeLessThan(easy.easiness);
    expect(easy.easiness).toBeGreaterThan(DEFAULT_EASINESS);
  });

  it('counts every attempt, so the Great Library can be honest about lapses', () => {
    let record = reviewMastery(newRecord('t'), 5, T0);
    record = reviewMastery(record, 1, T0 + DAY_MS);
    expect(record.reviews).toBe(2);
    expect(record.lapses).toBe(1);
  });

  it('falls due on the real clock once the interval has elapsed', () => {
    const record = reviewMastery(newRecord('t'), 4, T0);
    expect(dueAt(record)).toBe(T0 + DAY_MS);
    expect(isDue(record, T0 + DAY_MS - 1)).toBe(false);
    expect(isDue(record, T0 + DAY_MS)).toBe(true);
  });
});

describe('the compressed in-session clock', () => {
  const sessionDayMs = 1_000;

  it('brings an item back within a sitting, which real days never would', () => {
    const record = reviewMastery(newRecord('t'), 4, T0);
    // Six real days away, so the real clock says not due.
    expect(isDue(record, T0 + 2_000)).toBe(false);
    expect(
      isDue(record, T0 + 2_000, { sessionStart: T0 - 10_000, sessionDayMs }),
    ).toBe(true);
  });

  it('measures from the last review, not the start of the session', () => {
    /*
     * Otherwise an item reviewed thirty seconds ago reappears immediately
     * just because the session has been running for an hour, which feels
     * broken and teaches nothing.
     */
    const record = reviewMastery(newRecord('t'), 4, T0);
    expect(
      isDue(record, T0 + 500, { sessionStart: T0 - 3_600_000, sessionDayMs }),
    ).toBe(false);
  });

  it('is off unless a session start is supplied', () => {
    const record = reviewMastery(newRecord('t'), 4, T0);
    expect(isDue(record, T0 + 999_999, { sessionDayMs })).toBe(false);
  });
});

describe('scoring to quality', () => {
  it('treats a slow but correct answer as recall, not failure', () => {
    // The boundary that matters: below 3 the interval collapses. "I got there
    // in the end" must not be punished like a blank.
    expect(qualityFromScore(0.6)).toBeGreaterThanOrEqual(3);
    expect(qualityFromScore(0)).toBeGreaterThanOrEqual(3);
  });

  it('treats a wrong answer and a timeout as failures', () => {
    expect(qualityFromScore(-1)).toBeLessThan(3);
    expect(qualityFromScore(-0.6)).toBeLessThan(3);
  });

  it('gives an abandoned challenge the lowest quality', () => {
    expect(qualityFromScore(1, true)).toBe(0);
  });

  it('rewards speed above mere correctness', () => {
    expect(qualityFromScore(1)).toBeGreaterThan(qualityFromScore(0.6));
  });
});

describe('mastery bands', () => {
  it('reports an unreviewed topic as unseen', () => {
    expect(masteryBand(undefined)).toBe('unseen');
    expect(masteryBand(newRecord('t'))).toBe('unseen');
  });

  it('climbs from learning to strong as the interval grows', () => {
    expect(masteryBand(reviewMastery(newRecord('t'), 4, T0))).toBe('learning');
    expect(masteryBand(passTimes(newRecord('t'), 2))).toBe('familiar');
    expect(masteryBand(passTimes(newRecord('t'), 5, 5))).toBe('strong');
  });
});

describe('the mastery tracker', () => {
  it('only returns topics it has actually seen', () => {
    /*
     * The guard that stops the whole tech tree falling due on turn one. SM-2
     * calls an unreviewed record due, which is right for a deck of cards
     * somebody added on purpose and wrong for 41 skills the player has not
     * researched yet.
     */
    const tracker = createMasteryTracker();
    tracker.record('dp600-12', 1, false, T0);
    const due = tracker.dueTopics(T0 + 400 * DAY_MS, ['dp600-12', 'dp600-13', 'dp600-14']);
    expect(due).toEqual(['dp600-12']);
  });

  it('reschedules a topic out of the due list once it is answered', () => {
    const tracker = createMasteryTracker();
    tracker.record('t', 1, false, T0);
    expect(tracker.dueTopics(T0 + 1, ['t'])).toEqual([]);
    expect(tracker.dueTopics(T0 + 2 * DAY_MS, ['t'])).toEqual(['t']);
  });

  it('returns the most neglected topic first', () => {
    const tracker = createMasteryTracker();
    tracker.record('older', 1, false, T0);
    tracker.record('newer', 1, false, T0 + 60 * 60 * 1000);
    expect(tracker.dueTopics(T0 + 30 * DAY_MS, ['newer', 'older'])).toEqual([
      'older',
      'newer',
    ]);
  });

  it('persists through the store, so a session is not forgotten on reload', () => {
    const store = memoryStore();
    createMasteryTracker({ store }).record('t', 1, false, T0);

    const reloaded = createMasteryTracker({ store });
    expect(reloaded.get('t')?.reviews).toBe(1);
  });

  it('survives a store that cannot be read', () => {
    // A learner who loses their history is unlucky. A learner who cannot open
    // the game at all is a bug. Writing this test is what found that the
    // tracker did not actually guard the read it claimed to.
    const broken = {
      load: () => {
        throw new Error('storage exploded');
      },
      save: () => {
        throw new Error('storage still exploded');
      },
    };
    const tracker = createMasteryTracker({ store: broken });
    expect(tracker.get('anything')).toBeUndefined();
    expect(() => tracker.record('t', 1, false, T0)).not.toThrow();
    expect(tracker.get('t')?.reviews).toBe(1);
  });

  it('summarises a set of topics by band', () => {
    const tracker = createMasteryTracker();
    tracker.record('a', 1, false, T0);
    const summary = tracker.summary(['a', 'b', 'c']);
    expect(summary.unseen).toBe(2);
    expect(summary.learning + summary.familiar + summary.strong).toBe(1);
  });

  it('reports per topic for the Great Library', () => {
    const tracker = createMasteryTracker();
    tracker.record('a', 1, false, T0);
    const report = tracker.report(['a', 'b'], T0 + 2 * DAY_MS);
    expect(report).toHaveLength(2);
    expect(report[0]!.due).toBe(true);
    expect(report[1]!.band).toBe('unseen');
    expect(report[1]!.due).toBe(false);
  });
});
