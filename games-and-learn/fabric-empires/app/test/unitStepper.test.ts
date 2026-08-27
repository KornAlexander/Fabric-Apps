import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
  The arrows that step through your units.

  The defect this file guards against is not that stepping is wrong, it is
  that stepping is USELESS: the game already had a "next idle unit" key that
  deliberately skips anything fortified or out of moves, and reusing it for a
  pair of visible arrows would mean the unit currently on screen, which is very
  often exactly one of those, cannot be stepped away from and back to.
*/

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');
const main = read('app/src/main.ts');
const html = read('app/index.html');

/** The body of `stepUnit`, which is the whole feature. */
function stepUnit(): string {
  const start = main.indexOf('function stepUnit(');
  expect(start).toBeGreaterThan(0);
  return main.slice(start, main.indexOf('\n}', start));
}

/**
 * The index `stepUnit` lands on, reimplemented from its own arithmetic.
 *
 * ⚠️ A reimplementation, not the real function: `main.ts` runs a whole game on
 * import (canvas, WebGL, audio), so it cannot be loaded in a test. The source
 * assertions below are what keep this copy honest about the parts that matter.
 */
function landing(count: number, current: number, delta: number): number {
  const from = current === -1 ? (delta > 0 ? -1 : 0) : current;
  return (from + delta + count * 2) % count;
}

describe('stepping through the army', () => {
  it('⚠️ walks every unit, not only the ones still awaiting orders', () => {
    /*
     * `selectNextIdle` filters on `movesLeft > 0 && !fortified`. If the arrows
     * did that too, a fortified unit could be shown but never returned to,
     * which is the state a player most wants to inspect.
     */
    const body = stepUnit();
    expect(body).toContain('ownUnits()');
    expect(body).not.toContain('movesLeft');
    expect(body).not.toContain('fortified');
  });

  it('keeps a stable order, so a unit does not move in the cycle', () => {
    const own = main.slice(main.indexOf('function ownUnits('));
    // Insertion order of the Map. Sorting by position would reshuffle the
    // cycle every time anything moved.
    //
    // ⚠️ `mySeat`, not the player constant: after taking a vacant seat the
    // army you step through is a different faction's, and reading the constant
    // would cycle an empire you can no longer give orders to.
    expect(own.slice(0, 200)).toContain('unitsOf(state, mySeat)');
    expect(own.slice(0, 200)).not.toContain('sort');
  });

  it('wraps forwards off the end', () => {
    expect(landing(3, 2, 1)).toBe(0);
  });

  it('wraps backwards off the start', () => {
    // ⚠️ The reason for the `+ count * 2`: a bare `-1 % 3` is -1 in
    // JavaScript, which would index nothing and select undefined.
    expect(landing(3, 0, -1)).toBe(2);
  });

  it('⚠️ from no selection, forward and back land on different units', () => {
    /*
     * Otherwise both arrows do the same thing when a unit has just died,
     * which is exactly the moment a player reaches for them.
     */
    expect(landing(4, -1, 1)).toBe(0);
    expect(landing(4, -1, -1)).toBe(3);
  });

  it('is a no-op with a single unit rather than appearing to do nothing wrong', () => {
    expect(landing(1, 0, 1)).toBe(0);
    expect(landing(1, 0, -1)).toBe(0);
  });

  it('focuses the camera, because selecting off-screen would show nothing', () => {
    expect(stepUnit()).toContain('scene.focus(next.hex)');
  });
});

describe('the arrows in the panel', () => {
  it('are wired to both directions', () => {
    expect(main).toContain("el.selPrev.addEventListener('click', () => stepUnit(-1))");
    expect(main).toContain("el.selNext.addEventListener('click', () => stepUnit(1))");
  });

  it('⚠️ are refreshed before the nothing-selected early return', () => {
    /*
     * `refreshSelection` returns early when there is no unit. If the stepper
     * were updated after that, it would be left disabled exactly when the
     * player has nothing selected and most needs it.
     */
    const fn = main.slice(main.indexOf('function refreshSelection('));
    const stepper = fn.indexOf('el.selPrev.disabled');
    const earlyReturn = fn.indexOf('t(\'Nothing selected\')');
    expect(stepper).toBeGreaterThan(0);
    expect(stepper).toBeLessThan(earlyReturn);
  });

  it('are disabled only when the player owns no units at all', () => {
    const fn = main.slice(main.indexOf('function refreshSelection('));
    expect(fn).toContain('el.selPrev.disabled = own.length === 0');
    expect(fn).toContain('el.selNext.disabled = own.length === 0');
  });

  it('⚠️ do not take the arrow keys, which mean "look" in free flight', () => {
    expect(main).toContain("e.key === '['");
    expect(main).toContain("e.key === ']'");
    const keys = main.slice(main.indexOf("e.key === 'n' || e.key === 'Tab'"));
    expect(keys.slice(0, 1200)).not.toContain('ArrowLeft');
  });

  it('have translated tooltips, so the German build does not show English', () => {
    expect(html).toContain('data-i18n-title="Previous unit ([)"');
    expect(html).toContain('data-i18n-title="Next unit (])"');
    const i18n = read('app/src/i18n.ts');
    expect(i18n).toContain("'Previous unit ([)':");
    expect(i18n).toContain("'Next unit (])':");
  });

  it('⚠️ let a long unit name ellipse rather than pushing the arrows away', () => {
    // "Direct Lake Titan" in a 290px panel; without `min-width: 0` a flex
    // child refuses to shrink below its content and the buttons leave.
    expect(html).toContain('.sel-head h2 { flex: 1 1 auto; min-width: 0;');
  });
});
