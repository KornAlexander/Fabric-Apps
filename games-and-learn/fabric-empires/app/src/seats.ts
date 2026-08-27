/**
 * The seat table: which empires are on the board, and which you may take.
 *
 * The engine already knows who is playing what (`control` on a faction) and
 * how everyone is doing (`standings`). This module is the one that turns that
 * into a sentence somebody can choose from, and it is separate from `main.ts`
 * for one reason:
 *
 * ⚠️ **The wording IS the feature.** \"Take a seat\" is only a real decision if
 * the screen says what you would be taking on, and \"three towns\" says nothing
 * without \"the leader has nine\". Keeping the phrasing in a pure function means
 * a test can read the actual sentence, rather than a test asserting that some
 * numbers were passed to a dialog that might render them as anything.
 */

import { standings, type GameState, type Standing } from '@fabric-empires/engine';

export interface SeatOffer {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export interface SeatTable {
  readonly title: string;
  readonly body: string;
  /** The seats nobody is playing, strongest first. Empty when there are none. */
  readonly offers: readonly SeatOffer[];
  /** Where the person asking currently sits, if they sit anywhere. */
  readonly current: Standing | undefined;
}

const BANDS: Record<Standing['band'], string> = {
  commanding: 'commanding',
  holding: 'holding',
  struggling: 'struggling',
};

const percent = (share: number): string => `${Math.round(share * 100)}%`;

const countOf = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Describe the board as a set of choices.
 *
 * ⚠️ **Every offer is measured against the LEADER, not against itself.** The
 * question a joiner is really asking is "which of these is worth taking", and
 * that is comparative. An empire with four towns is strong in one game and
 * finished in another, and only the second number says which.
 */
export function seatTable(state: GameState, mySeat: string): SeatTable {
  const rows = standings(state);
  const current = rows.find((r) => r.factionId === mySeat);
  const leader = rows[0];

  const offers = rows
    .filter((r) => r.control === 'ai')
    .map((r) => ({
      id: r.factionId,
      label: `${r.label} — ${BANDS[r.band]}`,
      detail: describe(r, leader),
    }));

  const body = current
    ? `You are playing ${current.label}: ${BANDS[current.band]}, ${percent(current.share)} of the board. ` +
      `Taking another seat hands this empire back to the machine, and you start the new one blind.`
    : `You are not playing anybody. Take a seat to join.`;

  return {
    title: offers.length > 0 ? 'The seats on this board' : 'Every seat is taken',
    body,
    offers,
    current,
  };
}

function describe(row: Standing, leader: Standing | undefined): string {
  const own =
    `${countOf(row.cities, 'town', 'towns')}, ` +
    `${countOf(row.units, 'unit', 'units')}, ` +
    `${countOf(row.population, 'citizen', 'citizens')}. ` +
    `${percent(row.share)} of the board`;

  /*
   * ⚠️ The comparison is dropped when this row IS the leader, rather than
   * printed as "the strongest holds 34%" next to its own 34%. Telling somebody
   * that the best empire in the game is as good as the one they are looking at
   * reads as a bug even when it is arithmetically true.
   */
  if (!leader || leader.factionId === row.factionId) {
    return `${own}, and nobody on the board holds more.`;
  }
  return `${own}, against ${percent(leader.share)} for ${leader.label}.`;
}
