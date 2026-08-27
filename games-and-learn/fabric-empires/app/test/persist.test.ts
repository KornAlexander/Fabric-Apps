// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { createGameState, serialise, GENERIC_TOPIC_GRAPH } from '@fabric-empires/engine';

import { loadGame, localSlot, memorySlot, saveGame, SAVE_KEY } from '../src/persist.js';

/**
 * Persistence, tested at the two places it can hurt.
 *
 * A round trip is the easy half and mostly re-tests the engine. The half worth
 * writing is what happens when the stored string is not a save this build can
 * read, because that is the path a player hits after an update and the one
 * where "throw" and "start fresh with a note" look identical from the code and
 * completely different from the sofa.
 */

const topics = GENERIC_TOPIC_GRAPH;
const freshState = () => createGameState('FABRIC', { topics });

describe('save slots', () => {
  it('round trips a game through memory', () => {
    const slot = memorySlot();
    const state = freshState();
    expect(saveGame(slot, state)).toBe(true);

    const loaded = loadGame(slot, topics);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state.seed).toBe(state.seed);
    expect(loaded.state.turn).toBe(state.turn);
    expect(loaded.state.units.size).toBe(state.units.size);
    expect(loaded.state.cities.size).toBe(state.cities.size);
  });

  it('regenerates the map rather than storing it', () => {
    const slot = memorySlot();
    const state = freshState();
    saveGame(slot, state);

    // The whole reason a save is a few kilobytes instead of a few hundred.
    const json = slot.read() ?? '';
    expect(json).not.toContain('"tiles"');
    expect(json.length).toBeLessThan(20_000);

    const loaded = loadGame(slot, topics);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state.map.tiles.size).toBe(state.map.tiles.size);
  });

  it('reports an empty slot as empty, not as broken', () => {
    expect(loadGame(memorySlot(), topics)).toEqual({ ok: false, reason: 'empty' });
  });

  it('survives a corrupt save instead of throwing', () => {
    const slot = memorySlot();
    slot.write('{not json at all');
    expect(loadGame(slot, topics)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('survives a save from a newer build', () => {
    const slot = memorySlot();
    const save = JSON.parse(serialise(freshState()));
    slot.write(JSON.stringify({ ...save, version: 999 }));

    // The engine throws for this, deliberately. The app must not.
    expect(loadGame(slot, topics)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('survives a save that is valid JSON but not a save', () => {
    const slot = memorySlot();
    slot.write('[1,2,3]');
    expect(loadGame(slot, topics).ok).toBe(false);
  });

  it('clears', () => {
    const slot = memorySlot();
    saveGame(slot, freshState());
    slot.clear();
    expect(loadGame(slot, topics)).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('the browser slot', () => {
  beforeEach(() => window.localStorage.clear());

  it('persists through a new slot object, which is what a reload is', () => {
    saveGame(localSlot(), freshState());
    const loaded = loadGame(localSlot(), topics);
    expect(loaded.ok).toBe(true);
  });

  it('writes under the documented key', () => {
    saveGame(localSlot(), freshState());
    expect(window.localStorage.getItem(SAVE_KEY)).toBeTruthy();
  });

  /**
   * ⚠️ The case that decides whether the game boots at all in an iframe.
   *
   * A Fabric App is served in one, and partitioned storage there hands back a
   * `localStorage` that looks fine and throws on the first write. Checking
   * that the object exists would pass and the game would still die, so the
   * real slot probes with a write.
   */
  it('falls back to memory when storage throws, rather than failing to load', () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    try {
      const slot = localSlot();
      expect(saveGame(slot, freshState())).toBe(true);
      expect(loadGame(slot, topics).ok).toBe(true);
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
