import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ⚠️ The turn button's two jobs, pinned by reading the source.
 *
 * `main.ts` is the whole game wired together and cannot be imported under test
 * without a WebGL context, so this uses the same trick as the D205 guard and
 * the map-controls guard: read the file and assert the wiring.
 *
 * What it is protecting is not the label. It is that ending a turn stays hard
 * to do by accident while there is work outstanding, and that the button and
 * the spacebar can never disagree about what "the next thing" is.
 */
const source = readFileSync(join(process.cwd(), 'app', 'src', 'main.ts'), 'utf8');

describe('⚠️ the turn button is two buttons wearing one coat', () => {
  it('sends the button and the spacebar through the same decision', () => {
    // Both routes call turnButtonAction, so they cannot drift apart. Binding
    // the click straight to doEndTurn is exactly the regression to catch.
    expect(source).toContain("el.endTurn.addEventListener('click', turnButtonAction);");
    expect(source).not.toContain("el.endTurn.addEventListener('click', doEndTurn);");
  });

  it('lets Ctrl+Space end the turn with work outstanding', () => {
    const space = source.slice(source.indexOf("if (e.key === ' ')"));
    expect(space.slice(0, 700)).toMatch(/ctrlKey|metaKey/);
  });

  it('decides from live state, not from the label it last painted', () => {
    /*
     * ⚠️ A label can be one frame stale. Ending a turn because of a stale flag
     * cannot be undone, so `turnButtonAction` recomputes rather than reading
     * whatever `refreshTurnButton` decided last.
     */
    const fn = source.slice(source.indexOf('function turnButtonAction'));
    expect(fn.slice(0, 300)).toContain('pendingWork()');
  });

  /**
   * ⚠️ The one that makes the indicator worth having. A marching unit has
   * orders, so counting it as awaiting them would keep the turn looking
   * unfinished for the entire length of its journey, and the whole feature
   * would be least trustworthy exactly when marches are being used.
   */
  it('does not count a marching unit as awaiting orders', () => {
    const fn = source.slice(source.indexOf('function awaitingOrders'));
    const body = fn.slice(0, 300);
    expect(body).toContain('!u.order');
    expect(body).toContain('!u.fortified');
    expect(body).toContain('movesLeft > 0');
  });

  it('counts idle research and a due council, not only units', () => {
    const fn = source.slice(source.indexOf('function pendingWork'));
    const body = fn.slice(0, 600);
    expect(body).toContain('researchable(state)');
    expect(body).toContain('pendingReviews()');
  });
});
