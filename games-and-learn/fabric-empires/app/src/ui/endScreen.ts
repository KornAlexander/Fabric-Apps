import type { Outcome } from '@fabric-empires/engine';
import { t } from '../i18n.js';

/**
 * How a game ended.
 *
 * A superset of the engine's outcome, because the Exam victory is not an
 * engine concept and must not become one: it is a statement about weighted
 * readiness against a published certification outline, which the rules layer
 * is not allowed to know exists (D35).
 */
export type EndOutcome = Outcome | { readonly kind: 'exam'; readonly summary: string };

/**
 * The end of a game.
 *
 * Until now a finished game just kept going: the player could press End Turn
 * forever with nothing left to command, and the only sign was a line in the
 * log that scrolled away. An ending has to interrupt, which is the one thing
 * a log entry is designed not to do.
 *
 * ⚠️ It offers a new empire rather than closing back to the map. There is
 * nothing to go back to: on a defeat there is nothing to command, and on a
 * victory there is nothing left to take. A dismissable overlay would only
 * leave the player pressing a button that no longer does anything.
 */

const STYLE = `
.fe-end {
  position: fixed; inset: 0; z-index: 60; display: none;
  /*
    ⚠️ flex-start plus margin auto, not centre. A centred child taller than its
    container is clipped at the TOP and cannot be scrolled to. Measured, not
    theoretical: the setup screen lost its own title and blurb that way.
  */
  align-items: flex-start; justify-content: center;
  overflow: auto; padding: 16px 0;
  background: rgba(5, 8, 13, 0.72); backdrop-filter: blur(4px);
  font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; color: #e8eaf0;
}
.fe-end[data-open='true'] { display: flex; }
.fe-end-card {
  width: min(460px, 92vw); padding: 26px 28px; text-align: center;
  margin: auto;
  background: rgba(14, 18, 26, 0.96); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 12px; box-shadow: 0 24px 70px rgba(0,0,0,0.55);
}
.fe-end-kind {
  font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
  color: #7f96ad; margin-bottom: 6px;
}
.fe-end-card h2 { margin: 0 0 10px; font-size: 25px; }
.fe-end-card p { margin: 0 0 18px; color: #b9c7d6; }
.fe-end-stats {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  margin-bottom: 20px; padding: 12px 0;
  border-top: 1px solid rgba(255,255,255,0.09);
  border-bottom: 1px solid rgba(255,255,255,0.09);
}
.fe-end-stats div { display: flex; flex-direction: column; gap: 3px; }
.fe-end-stats b { font-size: 19px; font-variant-numeric: tabular-nums; }
.fe-end-stats span { font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: #7f96ad; }
.fe-end button {
  font: inherit; font-weight: 600; padding: 9px 20px; cursor: pointer;
  color: #08101c; background: #6fb3ff; border: none; border-radius: 6px;
}
.fe-end button:hover { background: #8cc4ff; }
.fe-end.win h2 { color: #8fd694; }
.fe-end.lose h2 { color: #ff9b91; }
.fe-end-cheats {
  margin: -8px 0 16px; font-size: 11px; line-height: 1.5;
  color: #ffcf7a;
}
`;

export interface EndScreenStats {
  readonly turn: number;
  readonly skills: string;
  readonly cities: number;
  /**
   * Cheat codes used in this game.
   *
   * ⚠️ Shown, always. A study tool must never let somebody finish believing an
   * empire was won unaided when it was not, because the next inference they
   * draw is about themselves.
   */
  readonly cheats: readonly string[];
}

export interface EndScreen {
  show(outcome: EndOutcome, stats: EndScreenStats): void;
  hide(): void;
  readonly isOpen: boolean;
}

const TITLES: Record<EndOutcome['kind'], string> = {
  defeat: 'Your empire has fallen',
  // ⚠️ Not the bare genre word. This is the line a screenshot quotes.
  conquest: 'The region is yours',
  mastery: 'Every skill mastered',
  exam: 'The Proctor is satisfied',
};

/**
 * The kinds of help that reached the readiness figure itself.
 *
 * ⚠️ This screen used to promise, unconditionally, that "your readiness figure
 * did not [have help], and never does". That was true for every typed cheat
 * code, which is exactly why it could be a constant: the console refuses to
 * touch readiness and says so in its own help text.
 *
 * It stopped being true when the debug harness started disclosing itself here.
 * `studyAll` records perfect mastery of all 41 topics, and readiness is
 * computed from mastery, so for that one entry the reassuring half of the
 * sentence was a falsehood printed underneath a victory. A disclosure that
 * lies is worse than no disclosure, because it is the thing a reader trusts
 * precisely when they are checking.
 */
const READINESS_HELP = new Set<string>(['harness:studyAll', 'harness:expireReviews']);

export function createEndScreen(onNewGame: () => void): EndScreen {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const root = document.createElement('div');
  root.className = 'fe-end';
  root.dataset.testid = 'end-screen';
  root.dataset.open = 'false';
  root.innerHTML = `
    <div class="fe-end-card">
      <div class="fe-end-kind" data-f="kind"></div>
      <h2 data-f="title"></h2>
      <p data-f="summary"></p>
      <div class="fe-end-stats">
        <div><b data-f="turn">-</b><span data-f="turns-label">turns</span></div>
        <div><b data-f="skills">-</b><span data-f="skills-label">skills</span></div>
        <div><b data-f="cities">-</b><span data-f="cities-label">cities</span></div>
      </div>
      <p class="fe-end-cheats" data-f="cheats" hidden></p>
      <button type="button" data-f="again">New empire</button>
    </div>
  `;
  document.body.append(root);

  const field = (name: string) => root.querySelector<HTMLElement>(`[data-f="${name}"]`);
  let open = false;

  root.querySelector<HTMLButtonElement>('[data-f="again"]')!.addEventListener('click', () => {
    hide();
    onNewGame();
  });

  function hide(): void {
    open = false;
    root.dataset.open = 'false';
  }

  return {
    show(outcome, stats) {
      open = true;
      root.classList.toggle('win', outcome.kind !== 'defeat');
      root.classList.toggle('lose', outcome.kind === 'defeat');
      const kind = field('kind');
      if (kind) kind.textContent = outcome.kind === 'defeat' ? t('Defeat') : t('Victory');

      /*
       * ⚠️ The static labels are translated here rather than in the markup.
       *
       * This whole screen was English inside a German game: a player who had
       * just won read "VICTORY / turns / skills / cities / New empire" with
       * German on every side of it. It was invisible to the i18n test because
       * a file that never calls `t()` has no literals for it to check, and the
       * test only walked a hand-written list of files that did.
       *
       * Set on every show, because the language can change between games.
       */
      const label = (name: string, text: string): void => {
        const node = field(name);
        if (node) node.textContent = text;
      };
      label('turns-label', t('turns'));
      label('skills-label', t('skills'));
      label('cities-label', t('cities'));
      label('again', t('New empire'));
      const title = field('title');
      if (title) title.textContent = t(TITLES[outcome.kind]);
      const summary = field('summary');
      /*
       * ⚠️ The engine writes its summaries in English as the canonical form
       * and the app translates on the way to the screen, which is the rule the
       * rest of the interface already follows. `t()` passes anything it does
       * not recognise straight through, so an unmapped sentence degrades to
       * English rather than to nothing.
       *
       * ⚠️ Known gap: the mastery summary interpolates the topic count into
       * the sentence in the engine, so it arrives here already assembled and
       * cannot be looked up. Translating it needs the engine to emit a key and
       * its parameters instead of finished prose, which is a larger change
       * than this one.
       */
      if (summary) summary.textContent = t(outcome.summary);
      const turn = field('turn');
      if (turn) turn.textContent = String(stats.turn);
      const skills = field('skills');
      if (skills) skills.textContent = stats.skills;
      const cities = field('cities');
      if (cities) cities.textContent = String(stats.cities);

      const cheats = field('cheats');
      if (cheats) {
        const used = stats.cheats;
        cheats.hidden = used.length === 0;
        if (used.length > 0) {
          const unique = [...new Set(used)];
          const touchedReadiness = unique.some((code) => READINESS_HELP.has(code));
          cheats.textContent =
            t('This empire had help: {codes}.', { codes: unique.join(', ') }) +
            ' ' +
            (touchedReadiness
              ? t('That includes the readiness figure, which was granted rather than earned.')
              : t('Your readiness figure did not, and never does.'));
        }
      }
      root.dataset.open = 'true';
      root.dataset.kind = outcome.kind;
    },
    hide,
    get isOpen() {
      return open;
    },
  };
}
