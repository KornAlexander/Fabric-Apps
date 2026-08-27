/**
 * The opening.
 *
 * A cinematic shot is a pure function of normalised time, which is the whole
 * reason these can be tested at all: no renderer, no canvas, no WebGL, just
 * arithmetic. So the things worth asserting are the ones a screenshot would
 * never catch, and the ones that broke while it was being built.
 */

import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ANTHEM_MARKS, introDurationMs, introShots, type IntroWorld } from '../src/intro.js';

const world: IntroWorld = {
  centre: new Vector3(0, 0, 0),
  extent: 48,
  home: new Vector3(22, 1.4, -17),
};

const shots = introShots(world);

/** A beat by name. Positions shift whenever the song gains or loses one. */
const byId = (id: string) => shots.find((s) => s.id === id)!;

describe('the opening sequence', () => {
  it('is six beats, in a fixed order', () => {
    expect(shots.map((s) => s.id)).toEqual([
      'intro-forge',
      'intro-build',
      'intro-dawn',
      'intro-rivers',
      'intro-hands',
      'intro-title',
    ]);
  });

  it('ends on the title and the thing the game is for', () => {
    const last = shots.at(-1)!;
    expect(last.title).toBe('FABRIC EMPIRES');
    expect(last.subtitle).toBe('Learn Fabric. Learn as a family.');
  });

  it('⚠️ names the beats with the words of the anthem', () => {
    /*
     * Not decoration. The film and the song are the same text in the same
     * order, and if somebody rewrites a card without touching the lyrics the
     * two drift apart silently.
     */
    expect(shots[0]!.title).toBe('Fabrica');
    expect(shots[1]!.title).toBe('');
    expect(shots[2]!.title).toBe('Ex nihilo');
    expect(shots[3]!.title).toBe('Flumina viam inveniunt');
    expect(shots[4]!.title).toBe('Manus parvae, manus magnae');
  });

  it('⚠️ carries no card across the wordless build', () => {
    /*
     * The anthem sings nothing between *Texamus una* and *Ex nihilo terra
     * surgit*. A card held over that names a line nobody is singing, which is
     * the same fault as showing one early.
     */
    const build = shots.find((s) => s.id === 'intro-build')!;
    expect(build.title).toBe('');
    expect(build.subtitle).toBe('');
    expect(shots.filter((s) => s.title === '')).toHaveLength(1);
  });
});

describe('⚠️ the cards land on the lines they name', () => {
  /*
   * The bug this exists to prevent: the sequence used to open on "Ex nihilo"
   * at t=0, while the anthem was still on its unaccompanied introduction. By
   * the time that line was sung the film had cut to the next card, so every
   * passage was one early. Nothing was broken and nothing looked wrong in a
   * screenshot; it just felt off.
   *
   * ⚠️ It then happened a second time, for a different reason, and that is why
   * these numbers are now imported rather than repeated here. Re-recording the
   * anthem replaced the performance the old constants described, and the film
   * drifted straight back out of sync. This table used to be a second copy of
   * the measurements, so it would have agreed with the code while both
   * disagreed with the music.
   */
  const SUNG_AT: Readonly<Record<string, number>> = {
    'intro-forge': ANTHEM_MARKS.forge,
    'intro-build': ANTHEM_MARKS.build,
    'intro-dawn': ANTHEM_MARKS.dawn,
    'intro-rivers': ANTHEM_MARKS.rivers,
    'intro-hands': ANTHEM_MARKS.hands,
    'intro-title': ANTHEM_MARKS.title,
  };
  /** The full choir enters here, and the title should still be up for it. */
  const CHORUS_MS = ANTHEM_MARKS.chorus;

  /** When each beat starts and ends, in milliseconds from the first frame. */
  function windows(): { id: string; start: number; end: number }[] {
    let at = 0;
    return shots.map((shot) => {
      const start = at;
      at += shot.durationMs;
      return { id: shot.id, start, end: at };
    });
  }

  it('shows each card while its own line is being sung', () => {
    for (const { id, start, end } of windows()) {
      const sung = SUNG_AT[id]!;
      expect(start, `${id} starts after its line`).toBeLessThanOrEqual(sung + 400);
      expect(end, `${id} leaves before its line`).toBeGreaterThan(sung + 1_500);
    }
  });

  it('⚠️ does not open on the verse while the soloist is still alone', () => {
    // The exact defect, stated as itself. "Ex nihilo" must not be the card on
    // screen at t=0; the unaccompanied introduction has its own.
    expect(shots[0]!.id).toBe('intro-forge');
    expect(shots[0]!.durationMs).toBeGreaterThanOrEqual(5_000);
  });

  it('holds the title card into the chorus', () => {
    const title = windows().at(-1)!;
    expect(title.start).toBeLessThan(CHORUS_MS);
    expect(title.end).toBeGreaterThan(CHORUS_MS);
  });

  it('⚠️ takes every card down as the next line begins', () => {
    /*
     * The other half of "the card lands on its line", and the half that was
     * missing. A card that arrives on time but outstays the passage is still
     * naming something nobody is singing any more, which is how the film read
     * before: one card covering three lines.
     *
     * Beat lengths therefore come from the marks by subtraction and must not
     * be hand-set. This asserts the arithmetic really is that, so a tweaked
     * `durationMs` cannot quietly reintroduce an overhang.
     */
    const order = windows();
    for (let i = 0; i < order.length - 1; i++) {
      const nextLine = SUNG_AT[order[i + 1]!.id]!;
      expect(order[i]!.end, `${order[i]!.id} overruns into the next line`)
        .toBeCloseTo(nextLine, 3);
    }
  });

  it('runs no longer than the anthem it is cut to', () => {
    // The recording is 193 s, so there is room, but a film that outlasts its
    // own music ends in silence.
    expect(introDurationMs(shots)).toBeLessThan(193_000);
  });
});

describe('the beats themselves', () => {
  it('gives every card long enough to be read', () => {
    /*
     * ⚠️ This floor was 5 s, and the measured recording makes that
     * unsatisfiable rather than merely tight. *Ex nihilo terra surgit* is sung
     * for 3.8 s and then *Flumina viam inveniunt* begins; a 5 s card would
     * still be on screen naming the previous line, which is the exact fault
     * this whole file exists to prevent.
     *
     * Raising a bound to make a change pass is usually how a guard dies, so
     * be clear about which one this is. The song sets the length of a beat.
     * What is still ours to get wrong is showing a card so briefly that it
     * cannot be read at all, and 3.5 s is the shortest line the anthem has.
     */
    for (const shot of shots) {
      if (shot.title === '') continue;
      expect(shot.durationMs, shot.id).toBeGreaterThanOrEqual(3_500);
      expect(shot.subtitle.length, shot.id).toBeGreaterThan(0);
    }
  });

  it('runs well under a minute, so it can be sat through', () => {
    /*
     * ⚠️ This bound was 45 s, and the re-recorded anthem made it unsatisfiable
     * rather than merely tight. Three requirements collide:
     *
     *   - the title card comes up on *Simul aedificant*, at 42.3 s
     *   - the title is still up when the full choir enters, at 48.8 s
     *   - a card is never on screen ahead of the line it names
     *
     * There is no film that satisfies all three and finishes inside 45 s,
     * because this take spends 42 s reaching a line the old one sang at 25.
     *
     * The guard is the *minute*, and it still holds. What actually protects
     * the player is that the film plays once per new game (a resumed empire
     * never sees it, D308) and Esc skips it at any frame.
     *
     * The alternative was to cut the audio, which would mean editing inside
     * sung phrases to remove 15 s, and an audible splice in the one piece of
     * music the game leads with is a worse outcome than a film nobody is
     * forced to watch twice.
     */
    const total = introDurationMs(shots);
    expect(total).toBeGreaterThan(20_000);
    expect(total).toBeLessThan(60_000);
  });
});

describe('⚠️ the camera stays above the ground', () => {
  /*
   * The failure this catches: a shot whose height is derived from the map
   * extent looks fine on a large map and puts the camera underground on a
   * small one, where the whole beat renders as the inside of a hill. Small
   * maps have radius 30 against 56 for large, so the difference is real.
   */
  it('on every world size, at every moment of every beat', () => {
    for (const extent of [12, 20, 33, 48, 60]) {
      const sized = introShots({ ...world, extent });
      for (const shot of sized) {
        for (let i = 0; i <= 20; i++) {
          const frame = shot.frame(i / 20);
          expect(
            frame.position.y,
            `${shot.id} at extent ${extent}, t=${i / 20}`,
          ).toBeGreaterThan(1.5);
        }
      }
    }
  });

  it('always looks at something, not at nothing', () => {
    for (const shot of shots) {
      for (let i = 0; i <= 10; i++) {
        const { position, target } = shot.frame(i / 10);
        expect(Number.isFinite(position.x + position.y + position.z)).toBe(true);
        expect(Number.isFinite(target.x + target.y + target.z)).toBe(true);
        // A camera sitting exactly on its own target has no orientation.
        expect(position.distanceTo(target)).toBeGreaterThan(1);
      }
    }
  });
});

describe('the shape of the flight', () => {
  it('opens close, pulls out to the whole world, and comes back close', () => {
    /*
     * The narrative in one assertion.
     *
     * ⚠️ This used to say "starts far away and finishes close", and the first
     * half stopped being true on purpose. The anthem opens with one
     * unaccompanied voice, so the film now opens on one tile, and the wide
     * reveal has moved to the second beat where it lands on *out of nothing,
     * the land rises*.
     *
     * The wide beat is still the point of the sequence: saying how big the
     * world is means showing more of it than the game will ever let you use.
     * And the film still ends close enough to see the people.
     */
    const reach = (f: { position: Vector3; target: Vector3 }): number =>
      f.position.distanceTo(f.target);

    /*
     * ⚠️ By id, not by index. This read `shots[1]` for "the widest", which
     * silently became the wordless build beat the moment one was inserted
     * ahead of the reveal. The test still passed something, just not the
     * thing it is named after.
     */
    const opening = reach(byId('intro-forge').frame(0));
    const widest = reach(byId('intro-dawn').frame(0));
    const last = reach(shots.at(-1)!.frame(1));

    // The opening beat is intimate, not an establishing shot.
    expect(opening).toBeLessThan(widest / 4);
    // The reveal is the widest thing in the film.
    expect(widest).toBeGreaterThan(last * 4);
    // And it comes back down to the people.
    expect(last).toBeLessThan(widest / 4);
  });

  it('⚠️ the opening beat reveals no more map than the reveal does', () => {
    /*
     * The opening lifts the fog of war while it runs, so a longer film risks
     * giving away more of a map the player is about to have hidden again. The
     * added beat is a close orbit over ground the player already occupies, so
     * every frame of it stays far inside what the wide beat shows anyway.
     */
    const widest = byId('intro-dawn').frame(0);
    const widestReach = widest.position.distanceTo(widest.target);
    for (let i = 0; i <= 20; i++) {
      const f = byId('intro-forge').frame(i / 20);
      expect(f.position.distanceTo(f.target)).toBeLessThan(widestReach);
    }
  });

  it('moves continuously inside each beat rather than jumping', () => {
    for (const shot of shots) {
      let previous = shot.frame(0).position;
      let longest = 0;
      for (let i = 1; i <= 60; i++) {
        const next = shot.frame(i / 60);
        longest = Math.max(longest, previous.distanceTo(next.position));
        previous = next.position;
      }
      // A sixtieth of an eased move should never be a large fraction of it.
      const span = shot.frame(0).position.distanceTo(shot.frame(1).position);
      expect(longest, shot.id).toBeLessThan(Math.max(2, span * 0.2));
    }
  });
});
