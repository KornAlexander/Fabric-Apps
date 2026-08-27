import { describe, expect, it } from 'vitest';

import {
  HOLD_MS,
  STORAGE_KEY,
  distanceBetween,
  flightMs,
  loadStory,
  parseBookmark,
  saveStory,
  type Bookmark,
} from '../bookmarks';

function stop(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'stop-1',
    label: 'Altenahr · 01:15',
    minutes: 17,
    position: { x: 1000, y: 2000, z: 3000 },
    target: { x: 0, y: 100, z: 0 },
    layers: { hazard: false, landuse: true, trees: true, exaggerated: false },
    ...overrides,
  };
}

/** A localStorage stand-in, plus variants that fail the way real ones do. */
function memoryStorage(seed?: string) {
  let value = seed ?? null;
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v;
    },
    read: () => value,
  };
}

describe('flight pacing', () => {
  it('is slower than the 1.5 s village hop, because it is narration rather than navigation', () => {
    expect(flightMs(0)).toBeGreaterThan(1500);
  });

  it('grows with distance, so a valley-length hop reads as further than a nudge', () => {
    expect(flightMs(4000)).toBeGreaterThan(flightMs(400));
  });

  it('caps, so the longest hop does not outstay its welcome', () => {
    expect(flightMs(1_000_000)).toBe(flightMs(50_000));
    expect(flightMs(1_000_000)).toBeLessThanOrEqual(7000);
  });

  it('never returns a negative duration for a nonsense distance', () => {
    expect(flightMs(-500)).toBeGreaterThan(0);
  });

  it('leaves time to actually read the stop once the camera arrives', () => {
    expect(HOLD_MS).toBeGreaterThan(1000);
  });
});

describe('parsing a stop', () => {
  it('round-trips a stop through storage', () => {
    const storage = memoryStorage();
    const story = [stop(), stop({ id: 'stop-2', minutes: -360 })];
    saveStory(storage, story);
    expect(loadStory(storage)).toEqual(story);
  });

  it('keeps the timepoint — the reason a bookmark is more than a camera angle', () => {
    const storage = memoryStorage();
    saveStory(storage, [stop({ minutes: -412 })]);
    expect(loadStory(storage)[0].minutes).toBe(-412);
  });

  it('keeps minute zero rather than treating it as missing', () => {
    expect(parseBookmark({ ...stop(), minutes: 0 })?.minutes).toBe(0);
  });

  it('restores the exaggeration flag, because the saved camera coordinates depend on it', () => {
    const restored = parseBookmark({ ...stop(), layers: { exaggerated: true } });
    expect(restored?.layers.exaggerated).toBe(true);
  });

  it('defaults the layers a viewer normally has on to on, and hazard to off', () => {
    const restored = parseBookmark({ ...stop(), layers: undefined });
    expect(restored?.layers).toEqual({
      hazard: false,
      landuse: true,
      trees: true,
      exaggerated: false,
    });
  });

  it('rejects a stop with no camera rather than flying to the origin', () => {
    expect(parseBookmark({ ...stop(), position: undefined })).toBeNull();
    expect(parseBookmark({ ...stop(), target: { x: 1, y: 2 } })).toBeNull();
  });

  it('rejects a stop whose time is not a number', () => {
    expect(parseBookmark({ ...stop(), minutes: 'later' })).toBeNull();
    expect(parseBookmark({ ...stop(), minutes: Number.NaN })).toBeNull();
  });
});

describe('surviving a bad disk', () => {
  it('drops the stops it cannot read and keeps the ones it can', () => {
    const storage = memoryStorage(
      JSON.stringify([stop(), { id: 'broken' }, stop({ id: 'stop-3' })])
    );
    const story = loadStory(storage);
    expect(story.map((s) => s.id)).toEqual(['stop-1', 'stop-3']);
  });

  it('returns an empty story for corrupt JSON instead of taking the panel down', () => {
    expect(loadStory(memoryStorage('{not json'))).toEqual([]);
  });

  it('returns an empty story when the stored value is not a list', () => {
    expect(loadStory(memoryStorage('{"id":"stop-1"}'))).toEqual([]);
  });

  it('survives storage being blocked outright, as in private mode', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(loadStory(blocked)).toEqual([]);
    expect(() => saveStory(blocked, [stop()])).not.toThrow();
  });

  it('writes under a versioned key, so a future format change cannot half-read this one', () => {
    const storage = memoryStorage();
    saveStory(storage, [stop()]);
    expect(STORAGE_KEY).toMatch(/\.v\d+$/);
    expect(storage.read()).toContain('stop-1');
  });
});

describe('distance', () => {
  it('measures in three dimensions, so a hop that is mostly altitude still counts', () => {
    expect(distanceBetween({ x: 0, y: 0, z: 0 }, { x: 0, y: 300, z: 400 })).toBe(500);
  });
});
