/**
 * The seat table: which empires are on the board, and which you may take.
 *
 * The engine already knows who is playing what (`control` on a faction) and
 * how everyone is doing (`standings`). This module is the one that turns that
 * into a sentence somebody can choose from, and it is separate from `main.ts`
 * for one reason:
 *
 * ⚠️ **The wording IS the feature.** "Take a seat" is only a real decision if
 * the screen says what you would be taking on, and "three towns" says nothing
 * without "the leader has nine". Keeping the phrasing in a pure function means
 * a test can read the actual sentence, rather than a test asserting that some
 * numbers reached a dialog which might render them as anything at all.
 */

import { standings, type GameState, type Standing } from '@fabric-empires/engine';
import { plural, t } from './i18n.js';

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

/** The one-word verdict, translated. */
function band(row: Standing): string {
  if (row.band === 'commanding') return t('commanding');
  if (row.band === 'holding') return t('holding');
  return t('struggling');
}

const percent = (share: number): string => `${Math.round(share * 100)}%`;

/**
 * Describe the board as a set of choices.
 *
 * ⚠️ **Every offer is measured against the LEADER, not against itself.** The
 * question a joiner is really asking is "which of these is worth taking", and
 * that is a comparison. Four towns is a strong empire in one game and a
 * finished one in another, and only the second number says which.
 */
export function seatTable(state: GameState, mySeat: string): SeatTable {
  const rows = standings(state);
  const current = rows.find((r) => r.factionId === mySeat);
  const leader = rows[0];

  const offers = rows
    .filter((r) => r.control === 'ai')
    .map((r) => ({
      id: r.factionId,
      /*
       * ⚠️ Assembled rather than translated. Both halves are already
       * translated, and a key whose German is identical to its English is
       * exactly what the i18n test calls out as a string somebody forgot.
       *
       * ⚠️ A colon, not an em dash. There is a test forbidding em and en
       * dashes in this app's text, and it is right to: they are not a German
       * punctuation mark and they read as an import.
       */
      label: `${r.label}: ${band(r)}`,
      detail: describe(r, leader),
    }));

  const body = current
    ? t(
        'You are playing {empire}: {band}, {share} of the board. Taking another seat hands it back to the machine, and you start the new one blind.',
        {
          empire: current.label,
          band: band(current),
          share: percent(current.share),
        },
      )
    : t('You are not playing anybody yet.');

  return {
    title: offers.length > 0 ? t('The empires on this board') : t('Every empire is being played'),
    body,
    offers,
    current,
  };
}

function describe(row: Standing, leader: Standing | undefined): string {
  const holdings = [
    plural(row.cities, '{n} town', '{n} towns'),
    plural(row.units, '{n} unit', '{n} units'),
    plural(row.population, '{n} citizen', '{n} citizens'),
  ].join(', ');

  /*
   * ⚠️ The comparison is dropped when this row IS the leader, rather than
   * printed as "against 34% for them" beside its own 34%. Telling somebody
   * that the strongest empire in the game is doing as well as the one they are
   * looking at reads as a bug, even though it is arithmetically true.
   */
  if (!leader || leader.factionId === row.factionId) {
    return t('{holdings}. {share} of the board, and nobody holds more.', {
      holdings,
      share: percent(row.share),
    });
  }
  return t('{holdings}. {share} of the board, against {best} for {leader}.', {
    holdings,
    share: percent(row.share),
    best: percent(leader.share),
    leader: leader.label,
  });
}
