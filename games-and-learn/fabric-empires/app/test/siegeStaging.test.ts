import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
  The siege set piece.

  ⚠️ Almost all of this is read from the source rather than executed, and that
  is a deliberate limit rather than laziness. `siege.ts` builds three.js
  geometry, drives a camera and animates on `requestAnimationFrame`; running it
  headlessly would test a mock of the renderer, which is precisely the shape of
  test that let section 95's bug live for weeks. What CAN be pinned here are the
  decisions: that each tactic is staged differently, that the props are always
  taken away again, and that the rules decide what is shown rather than the
  animation guessing.

  What it looks like is a question for eyes, and PLAN records what those eyes
  saw on the deployed build.
*/

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');
const siege = read('app/src/three/siege.ts');
const main = read('app/src/main.ts');

describe('which fight gets a siege', () => {
  it('⚠️ a town is besieged; a unit in the field still gets a duel', () => {
    /*
     * The duel is not replaced, it is narrowed. A ram rolling up to a lone
     * scout in a field would be sillier than the overhead lunge it replaced.
     */
    expect(main).toContain('playSiege');
    expect(main).toContain('playDuel');
  });

  it('picks the siege from the target being a city, not from the damage', () => {
    // `dramatic` used to stand in for "this is a city", which was a rendering
    // flag doing a rules job.
    const calls = [...main.matchAll(/playSiege\(/g)];
    expect(calls.length).toBeGreaterThan(0);
    expect(main).toMatch(/city\s*(!==|\?|&&|,)/);
  });
});

describe('the three tactics are three different things', () => {
  it('stages each one in its own routine', () => {
    for (const move of ['escalade', 'sap', 'batter']) {
      expect(siege, move).toContain(`async function ${move}(`);
    }
  });

  it('⚠️ branches on the tactic the ENGINE reported', () => {
    /*
     * The animation must not choose the tactic. It was chosen when the player
     * answered the assault dialog, and staging a different one would make the
     * dialog a lie.
     */
    expect(siege).toContain("outcome.tactic === 'escalade'");
    expect(siege).toContain("outcome.tactic === 'sap'");
  });

  it('gives escalade the ladders and sap the charge', () => {
    const ladders = siege.slice(siege.indexOf('async function escalade('));
    expect(ladders.slice(0, 4000)).toContain('ladder(');

    const mine = siege.slice(siege.indexOf('async function sap('));
    expect(mine.slice(0, 4000)).toMatch(/smoke|dust/);
  });

  it('gives batter a ram with a head that swings', () => {
    expect(siege).toContain('function ram(');
    const swing = siege.slice(siege.indexOf('async function batter('));
    expect(swing.slice(0, 4000)).toContain('head');
  });
});

describe('the defenders answer with the stance that was chosen', () => {
  it('mans the wall before the assault starts', () => {
    expect(siege).toContain('manTheWall');
    const order = siege.indexOf('manTheWall(props');
    expect(order).toBeGreaterThan(0);
    expect(order).toBeLessThan(siege.indexOf("outcome.tactic === 'escalade'"));
  });

  it('⚠️ brace ducks and does not shoot back', () => {
    /*
     * Bracing sets `counter: 0` in the rules: a braced garrison returns
     * nothing. Showing them loosing arrows anyway would contradict the number
     * the player just chose.
     */
    expect(siege).toContain("stance === 'brace'");
  });

  it('sally opens the gate and comes out', () => {
    expect(siege).toContain("stance === 'sally'");
  });
});

describe('the props are always taken away', () => {
  it('⚠️ disposes in a finally, not on the happy path', () => {
    /*
     * A thrown frame or a skipped shot must not leave a ram parked outside
     * somebody's town for the rest of the game.
     */
    const body = siege.slice(siege.indexOf('export async function playSiege('));
    const finallyAt = body.indexOf('} finally {');
    expect(finallyAt).toBeGreaterThan(0);
    expect(body.slice(finallyAt, finallyAt + 400)).toContain('props.dispose()');
  });

  it('⚠️ frees its own materials, which nothing else shares', () => {
    /*
     * `entities.ts` caches materials by name; these are built per siege and
     * are not in that cache, so nothing else will ever dispose them. A siege
     * a turn for an hour is a lot of orphaned GPU memory.
     */
    const dispose = siege.slice(siege.indexOf('dispose(): void {'));
    expect(dispose.slice(0, 400)).toContain('item.dispose()');
  });

  it('hands the attacker back to the renderer', () => {
    expect(siege).toContain('fx.clearPose(sides.attackerId)');
  });
});

describe('the shot', () => {
  it('⚠️ is aimed from the wall outward, not from the town', () => {
    /*
     * Everything is placed relative to the face under attack. Building from
     * the town outward is how the first draft assaulted the far side of the
     * fortress while the army stood behind the camera.
     */
    expect(siege).toContain('attackerGround.clone().sub(cityGround)');
  });

  it('⚠️ aims at the middle of the wall, so the fight is in frame', () => {
    /*
     * Corrected from watching the deployed build. The first cut aimed at
     * `wallHead`, and a low camera looking up at a parapet puts the ram, the
     * ladders and every soldier below the bottom edge: it was a shot of
     * masonry with the fight happening off screen.
     */
    const shot = siege.slice(siege.indexOf('scene.cinema.play('));
    expect(shot.slice(0, 1200)).toContain('wallMid');
    expect(shot.slice(0, 1200)).not.toContain('target: wallHead');
  });

  it('⚠️ sits above the scenery rather than inside it', () => {
    /*
     * At 0.52 the camera stood in the canopy of the trees on the attacker's
     * own hex and one of them filled the middle of the picture. The guard is
     * on the number because the number is the whole fix.
     */
    const shot = siege.slice(siege.indexOf('scene.cinema.play('));
    const height = /const height = ([\d.]+)/.exec(shot.slice(0, 1600));
    expect(height, 'the shot still sets a height').not.toBeNull();
    expect(Number(height?.[1])).toBeGreaterThan(0.7);
  });

  it('⚠️ clears the interface out of the frame', () => {
    /*
     * The first live look at the deployed siege was composed behind the
     * research panel, the city panel, the unit card and the log, which is the
     * difference between a cinematic and a screenshot of a game. The overlay
     * already owned the answer, so the siege borrows it instead of growing a
     * second way to fade the same panels.
     */
    expect(main).toContain('playSiegeFramed');
    const framed = main.slice(main.indexOf('async function playSiegeFramed('));
    expect(framed.slice(0, 400)).toContain('cinemaOverlay.show');
    expect(framed.slice(0, 400)).toContain('cinemaOverlay.hide()');
  });

  it('⚠️ fades the battle banner too, which sat across the middle of it', () => {
    /*
     * The banner is not a `.panel`, so the first framing pass left a box of
     * text over the one frame where the ram reaches the gate. It outlives the
     * shot, so fading it delays the numbers rather than hiding them.
     */
    const overlay = read('app/src/ui/cinematicOverlay.ts');
    expect(overlay).toContain('body.fe-cine-on .fe-battle');
  });

  it('⚠️ takes the bars off, because a siege is not a once-a-game moment', () => {
    /*
     * The letterbox and the title card are sized for the intro and first
     * blood. Stamping them over every assault late in a game turns a flourish
     * into a tax; what a siege wants from the overlay is the panel fade.
     */
    const framed = main.slice(main.indexOf('async function playSiegeFramed('));
    expect(framed.slice(0, 400)).toContain('bars: false');
  });

  it('⚠️ every siege call goes through the framed wrapper', () => {
    /*
     * A raid resolved by the AI is staged by a different call site than a
     * player's attack. One of the two framing the shot and the other not is
     * exactly the kind of drift that a single grep prevents.
     *
     * The wrapper's own call is the one legitimate bare one, so it is cut out
     * before counting rather than special-cased in the regex.
     */
    const wrapperAt = main.indexOf('async function playSiegeFramed(');
    expect(wrapperAt).toBeGreaterThan(0);
    const withoutWrapper = main.slice(0, wrapperAt) + main.slice(wrapperAt + 500);
    const bare = [...withoutWrapper.matchAll(/await playSiege\(/g)];
    expect(bare.length, 'unframed playSiege call sites').toBe(0);
  });
});

describe('skipping is a presentation choice, never a rules choice', () => {
  it('⚠️ lands the blow even when the player escapes out of the shot', () => {
    /*
     * `onImpact` is what hands the resolved state to the map. A siege that
     * returned early without calling it would leave the board showing a fight
     * that never happened, so it is idempotent and fired from the `finally`
     * on every path.
     */
    const body = siege.slice(siege.indexOf('export async function playSiege('));
    const finallyAt = body.indexOf('} finally {');
    expect(body.slice(finallyAt, finallyAt + 400)).toContain('land()');
    expect(body).toContain('if (impacted) return;');
  });

  it('reads the skip off the camera rather than inventing a second flag', () => {
    // The overlay's Escape already calls `scene.cinema.skip()`.
    expect(siege).toContain('scene.cinema.active');
  });
});
