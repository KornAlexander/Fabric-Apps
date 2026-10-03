/**
 * The empire table: what the join screen actually says.
 *
 * ⚠️ **The wording is the feature, so the wording is what is tested.** Taking
 * over an empire is only a real decision if the screen says what you would be
 * taking on, and "three towns" says nothing without "the leader has nine". A
 * test that asserted some numbers reached a dialog would pass whether or not
 * the sentence made that comparison, which is the only part that matters.
 */

import { describe, expect, it } from 'vitest';
import {
  ANTAGONIST_FACTION_ID,
  PLAYER_FACTION_ID,
  createGameState,
  takeSeat,
  vacantFactionIds,
  type GameState,
} from '@fabric-empires/engine';
import { setLang } from '../src/i18n.js';
import { seatTable } from '../src/seats.js';

const start = (): GameState => createGameState('FABRIC');

describe('what the table offers', () => {
  it('offers exactly the empires nobody is playing', () => {
    const state = start();
    const table = seatTable(state, PLAYER_FACTION_ID);
    expect(table.offers.map((o) => o.id)).toEqual(vacantFactionIds(state));
    expect(table.offers.map((o) => o.id)).not.toContain(PLAYER_FACTION_ID);
  });

  it('stops offering one the moment somebody sits in it', () => {
    const state = takeSeat(start(), ANTAGONIST_FACTION_ID);
    const table = seatTable(state, PLAYER_FACTION_ID);
    expect(table.offers.map((o) => o.id)).not.toContain(ANTAGONIST_FACTION_ID);
  });

  it('says so when there is nothing to take', () => {
    let state = start();
    for (const id of vacantFactionIds(state)) state = takeSeat(state, id);
    const table = seatTable(state, PLAYER_FACTION_ID);
    expect(table.offers).toEqual([]);
    expect(table.title).toContain('Every empire');
  });
});

describe('⚠️ the numbers are comparative, which is the whole point', () => {
  it('measures an offer against the strongest empire on the board', () => {
    /*
     * Four towns is a strong empire in one game and a finished one in another.
     * Only the second number says which, and a joiner is choosing BETWEEN
     * seats rather than appraising one in isolation.
     */
    const table = seatTable(start(), PLAYER_FACTION_ID);
    // ⚠️ Not `offers[0]`: that one IS the leader, and correctly has nothing to
    // be compared against. The comparison is what every OTHER row must carry.
    const offer = table.offers.at(-1)!;
    expect(offer.detail).toMatch(/\d+% of the board/);
    expect(offer.detail).toMatch(/against \d+% for /);
  });

  it('⚠️ drops the comparison when the offer IS the leader', () => {
    /*
     * "34% of the board, against 34% for The Silo Horde" is arithmetically
     * true and reads as a bug. On a fresh board the player holds no town, so
     * an antagonist leads and gets the no-comparison wording.
     */
    const table = seatTable(start(), PLAYER_FACTION_ID);
    const leader = table.offers[0]!;
    expect(leader.detail).toContain('nobody holds more');
    expect(leader.detail).not.toContain('against');
  });

  it('names the state of every empire in one word', () => {
    const table = seatTable(start(), PLAYER_FACTION_ID);
    for (const offer of table.offers) {
      expect(offer.label, offer.id).toMatch(/(commanding|holding|struggling)$/);
    }
  });

  it('counts towns, units and citizens, because those are the three things you inherit', () => {
    const offer = seatTable(start(), PLAYER_FACTION_ID).offers[0]!;
    expect(offer.detail).toMatch(/town/);
    expect(offer.detail).toMatch(/unit/);
    expect(offer.detail).toMatch(/citizen/);
  });

  it('gets the singular right, so it never says 1 towns', () => {
    // Every antagonist opens with exactly one village.
    const offer = seatTable(start(), PLAYER_FACTION_ID).offers[0]!;
    expect(offer.detail).toContain('1 town,');
    expect(offer.detail).not.toContain('1 towns');
  });
});

describe('what it says about where you are sitting', () => {
  it('names the empire being played and warns what leaving costs', () => {
    const table = seatTable(start(), PLAYER_FACTION_ID);
    expect(table.current?.factionId).toBe(PLAYER_FACTION_ID);
    expect(table.body).toContain('back to the machine');
    // ⚠️ The blindness is stated up front. Inheriting an empire but not its
    // scouting is the surprising half of the deal.
    expect(table.body).toContain('blind');
  });

  it('copes with nobody being seated', () => {
    const table = seatTable(start(), 'nobody-at-all');
    expect(table.current).toBeUndefined();
    expect(table.body).toContain('not playing anybody');
  });
});

describe('it speaks German too', () => {
  it('⚠️ translates the table, rather than leaving one panel in English', () => {
    /*
     * The offers are assembled from translated parts rather than from one
     * translated sentence, which is exactly the shape that goes stale in the
     * other language without anybody noticing.
     */
    setLang('de');
    try {
      const table = seatTable(start(), PLAYER_FACTION_ID);
      expect(table.title).toContain('Reiche');
      expect(table.body).toContain('Maschine');
      expect(table.offers[0]!.detail).toContain('Feldes');
      expect(table.offers[0]!.label).toMatch(/(überlegen|behauptet sich|in Bedrängnis)$/);
    } finally {
      setLang('en');
    }
  });

  it('⚠️ uses no em dash anywhere, in either language', () => {
    /*
     * There is a project-wide rule against em and en dashes, and a label built
     * by string concatenation is precisely where one sneaks past the
     * translation table that the i18n test checks.
     */
    for (const language of ['en', 'de'] as const) {
      setLang(language);
      const table = seatTable(start(), PLAYER_FACTION_ID);
      const text = [table.title, table.body, ...table.offers.flatMap((o) => [o.label, o.detail])];
      for (const line of text) {
        expect(line, `${language}: ${line}`).not.toMatch(/[\u2014\u2013]/);
      }
    }
    setLang('en');
  });
});
