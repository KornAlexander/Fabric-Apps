import { deserialise, serialise } from '@fabric-empires/engine';
import type { GameState, TopicGraph } from '@fabric-empires/engine';

/**
 * Keeping the empire between visits.
 *
 * The engine already knew how to save: `serialise` writes a few kilobytes
 * because the map is a pure function of the seed and is regenerated rather
 * than stored, and `deserialise` runs the version migrations on the way in.
 * None of it was ever called by the game, so closing the tab threw the empire
 * away while the review schedule in the other half of the app survived. That
 * split was the actual bug: the whole design rests on coming back tomorrow to
 * topics that are due, and there was nothing to come back to.
 *
 * ⚠️ **A bad save must never cost the player the game.** Everything here that
 * touches storage is written so the worst case is starting fresh with a line
 * in the log, not a blank screen. Storage throws more often than people
 * expect: private windows, a full quota, and cross-origin iframe embedding all
 * make `localStorage` unavailable, and an embedded iframe is exactly how a
 * Fabric App is served.
 */

export const SAVE_KEY = 'fabric-empires:save:v1';

export interface SaveSlot {
  read(): string | undefined;
  write(json: string): void;
  clear(): void;
}

/** A slot that forgets everything. Used when storage is unavailable. */
export function memorySlot(): SaveSlot {
  let held: string | undefined;
  return {
    read: () => held,
    write: (json) => {
      held = json;
    },
    clear: () => {
      held = undefined;
    },
  };
}

/**
 * The real slot, or a memory one if the browser will not have it.
 *
 * Probed with an actual write rather than by checking that `localStorage`
 * exists: Safari in private mode, and any iframe with storage partitioned off,
 * hand you a perfectly good looking object that throws on the first `setItem`.
 */
export function localSlot(key: string = SAVE_KEY): SaveSlot {
  try {
    const probe = `${key}:probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
  } catch {
    return memorySlot();
  }
  return {
    read: () => {
      try {
        return window.localStorage.getItem(key) ?? undefined;
      } catch {
        return undefined;
      }
    },
    write: (json) => {
      try {
        window.localStorage.setItem(key, json);
      } catch {
        // A quota failure must not interrupt the turn that triggered it.
      }
    },
    clear: () => {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Nothing useful to do, and nothing depending on it.
      }
    },
  };
}

/** Write the current game. Returns false if it could not be stored. */
export function saveGame(slot: SaveSlot, state: GameState): boolean {
  try {
    slot.write(serialise(state));
    return true;
  } catch {
    return false;
  }
}

export type LoadResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly reason: 'empty' | 'unreadable' };

/**
 * Read a saved game, if there is a readable one.
 *
 * The topic graph comes from the live challenge provider rather than the file,
 * which is the engine's rule and the right one: the graph is content, and
 * content ships with the build. A save written before a question was added
 * still loads against the newer tree.
 */
export function loadGame(slot: SaveSlot, topics: TopicGraph): LoadResult {
  const json = slot.read();
  if (!json) return { ok: false, reason: 'empty' };
  try {
    return { ok: true, state: deserialise(json, topics) };
  } catch {
    // Corrupt, hand-edited, or written by a build newer than this one. All
    // three mean the same thing to the player, and none of them should be a
    // stack trace on a blank page.
    return { ok: false, reason: 'unreadable' };
  }
}
