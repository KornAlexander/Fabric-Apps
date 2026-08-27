/**
 * The opening.
 *
 * ⚠️ **This is a title sequence, not a video file.** Everything here obeys the
 * rule the cinematic module opens with (D59): the camera moves through the
 * real, seed-generated world, so the establishing shot of a coastline is a
 * shot of *that* coastline, on the seed the player just typed, lit at the hour
 * the game is currently lit for. Two players who compare their openings are
 * looking at two different films.
 *
 * The cards are the sung passages of the anthem, in order, which is what makes
 * the film and the song the same text rather than a picture with music laid
 * over it. The last card is the only English in the sequence, and it is the
 * only thing the sequence is actually for:
 *
 *   Learn Fabric. Learn as a family.
 *
 * ⚠️ **The timings are measured against the recording, not chosen.** The
 * anthem opens with an unaccompanied boy soprano before Verse 1 begins, and
 * the film used to ignore that: it put "Ex nihilo" on screen at t=0, so by the
 * time *Ex nihilo terra surgit* was actually sung the sequence had already cut
 * to the next card. Every card was one passage early.
 *
 * ⚠️ **They are therefore measurements of ONE PERFORMANCE, and do not survive
 * a re-generation.** Re-recording the anthem on the Pro plan produced a take
 * that is slower through the same words, and the film went straight back to
 * showing each card ahead of its line. That is not a bug in either the film or
 * the song; it is what happens when a constant describes an artefact that got
 * replaced. `ANTHEM_MARKS` is the one place to fix it.
 *
 * ⚠️ **And it survived a second correction that was itself wrong.** The marks
 * below were re-measured once by watching for spectral change in the vocal
 * band, and that method cannot tell a sung line from a hummed one: the choir
 * hums under the whole of the build, so it read the hum as the verse and put
 * *Ex nihilo* at 9.0 s when it is sung at 26.9 s. Every middle card was then
 * about eighteen seconds early, which is most of a film.
 *
 * The marks are now taken from a forced alignment of the recording against the
 * lyric sheet (faster-whisper large-v3, Latin, word timestamps), cross-checked
 * against a second model and against pitch tracking for the unaccompanied
 * opening. That is a method that knows the difference between a word and a
 * vowel, which the spectrum does not.
 */

import { Vector3 } from 'three';
import {
  approachShot,
  descendShot,
  orbitShot,
  type CinematicShot,
} from './three/cinematic.js';

/**
 * Where each sung line begins, in milliseconds into the anthem.
 *
 * Located by aligning the recording against the known lyrics, word by word.
 *
 * | line | sung at | what the spectrum claimed |
 * | --- | --- | --- |
 * | *Fabrica* (soloist, alone) | 0.65 s | 8.46 s |
 * | *Texamus una* ends | 13.6 s | |
 * | *Ex nihilo terra surgit* | 26.88 s | 8.99 s |
 * | *Flumina viam inveniunt* | 30.70 s | 20.61 s |
 * | *Manus parvae, manus magnae* | 37.22 s | 29.44 s |
 * | *Simul aedificant* | 42.28 s | 41.52 s |
 * | full choir | 48.76 s | 49.76 s |
 *
 * ⚠️ **Nothing at all is sung between 13.6 s and 26.9 s.** The choir hums and
 * the orchestra builds, and that is why the spectrum was fooled. It is also
 * why the film has a beat with no card on it: text on screen during those
 * thirteen seconds is text that names nothing being sung.
 *
 * ⚠️ **One source of truth, deliberately.** These numbers used to exist twice,
 * once as `durationMs` values here and once as a `SUNG_AT` table in the test,
 * with nothing to make them agree. Two copies of a measurement is two chances
 * to update one of them.
 */
export const ANTHEM_MARKS = {
  /** The film opens here. The soloist's first *Fabrica* lands at 0.65 s. */
  forge: 0,
  /** *Texamus una* is finished. The choir hums, and no words follow for 13 s. */
  build: 13_600,
  /** *Ex nihilo terra surgit*, where Verse 1 actually starts. */
  dawn: 26_880,
  /** *Flumina viam inveniunt*. */
  rivers: 30_700,
  /** *Manus parvae, manus magnae*. */
  hands: 37_220,
  /** *Simul aedificant*, where the title card belongs. */
  title: 42_280,
  /** The full choir. The title must still be on screen for this. */
  chorus: 48_760,
  /** Where the film stops, a little past the choir's entry. */
  end: 53_500,
} as const;

/** How long a beat runs, from its own mark to the next one. */
const beat = (from: keyof typeof ANTHEM_MARKS, to: keyof typeof ANTHEM_MARKS): number =>
  ANTHEM_MARKS[to] - ANTHEM_MARKS[from];

export interface IntroWorld {
  /** The middle of the map, on the ground. */
  readonly centre: Vector3;
  /** Roughly how far the land reaches from that centre, in world units. */
  readonly extent: number;
  /** Where the player's people are standing at turn one. */
  readonly home: Vector3;
}

/**
 * The sequence, as data.
 *
 * A list rather than a routine so the whole thing stays a pure function of the
 * world: it can be counted, measured and asserted on without a renderer, and
 * the recorder can ask how long it runs before it starts rolling.
 */
export function introShots(world: IntroWorld): readonly CinematicShot[] {
  const { centre, extent, home } = world;

  /*
   * Beat zero. One voice, and almost nothing to look at.
   *
   * ⚠️ **This beat exists to hold the anthem's unaccompanied opening**, which
   * the film used to play underneath the wrong card. It is deliberately the
   * tightest shot in the sequence: a slow turn a few metres above the player's
   * own people, on ground they can already see.
   *
   * ⚠️ **It therefore shows no more of the map than the sequence already
   * did.** The opening lifts the fog while it runs, so a longer film could
   * easily mean giving away more of a map the player is about to have hidden
   * from them again. A close shot on the one tile they have already explored
   * adds seconds and reveals nothing.
   *
   * It runs exactly as long as the soloist does, and hands over the moment
   * *Texamus una* is finished.
   */
  const forge = orbitShot({
    id: 'intro-forge',
    title: 'Fabrica',
    subtitle: 'The workshop. Let us weave together',
    centre: home,
    radius: 5.5,
    fromHeight: 2.0,
    toHeight: 3.4,
    sweepRad: 0.34,
    startAngleRad: -1.2,
    durationMs: beat('forge', 'build'),
  });

  /*
   * Beat half. The climb, with nothing written on it.
   *
   * ⚠️ **The only card-less beat, and the reason is the recording.** Between
   * *Texamus una* and *Ex nihilo terra surgit* the anthem sings no words for
   * thirteen seconds: the choir hums, the strings come in underneath, and the
   * piece climbs towards the verse. A card held across that is a card naming a
   * line nobody is singing, which is the same fault as showing it early, only
   * slower.
   *
   * So the film says nothing and moves instead. The camera leaves the tight
   * turn on the home tile and climbs, which spends the build on the one thing
   * a build is for, and earns the cut: the wide map arrives on the downbeat of
   * *out of nothing, the land rises* rather than several seconds before it.
   */
  const build = orbitShot({
    id: 'intro-build',
    title: '',
    subtitle: '',
    centre: home,
    radius: extent * 0.2,
    fromHeight: 3.4,
    toHeight: extent * 0.5,
    sweepRad: 0.5,
    startAngleRad: -0.86,
    durationMs: beat('build', 'dawn'),
  });

  /*
   * Beat one. The whole map, from high up, turning slowly.
   *
   * Deliberately too far away to play from. The point of an opening shot is
   * to say how big the thing is, and the only way to say that is to show more
   * of it than the game will ever let you use at once.
   */
  const dawn = orbitShot({
    id: 'intro-dawn',
    title: 'Ex nihilo',
    subtitle: 'Out of nothing, the land rises',
    centre,
    radius: extent * 1.15,
    fromHeight: extent * 0.95,
    toHeight: extent * 0.62,
    sweepRad: 0.72,
    startAngleRad: -0.5,
    durationMs: beat('dawn', 'rivers'),
  });

  /*
   * Beat two. Down to the water, coming in across it.
   *
   * The coast is the most expensive thing in the scene, since it is the only
   * place the erosion, the shoreline smoothing and the refractive water are
   * all visible in one frame, so the film spends a beat there.
   */
  const rivers = approachShot({
    id: 'intro-rivers',
    title: 'Flumina viam inveniunt',
    subtitle: 'The rivers find their way',
    focus: home.clone().lerp(centre, 0.45),
    from: new Vector3(-0.8, 0, 0.6),
    startDistance: extent * 0.62,
    endDistance: extent * 0.2,
    startHeight: extent * 0.3,
    endHeight: extent * 0.075,
    durationMs: beat('rivers', 'hands'),
  });

  /*
   * Beat three. Onto the people.
   *
   * A fall rather than a pan, because this is the beat where the film stops
   * being about the landscape. The stands are small on purpose (D243) and the
   * camera has to come and find them, which is the honest way round.
   */
  const hands = descendShot({
    id: 'intro-hands',
    title: 'Manus parvae, manus magnae',
    subtitle: 'Small hands, great hands',
    centre: home,
    startHeight: extent * 0.34,
    endHeight: 2.6,
    radius: extent * 0.22,
    sweepRad: 0.85,
    durationMs: beat('hands', 'title'),
  });

  /*
   * Beat four. The title, on a slow close orbit.
   *
   * Held long. A title card that leaves before it has been read is a wasted
   * card, and this is the line the whole project is arguing for.
   *
   * ⚠️ It comes up on *Simul aedificant*, "together they build", and is still
   * on screen when the full choir enters. That is the loudest moment in the
   * piece and the title card should be sitting on it.
   */
  const title = orbitShot({
    id: 'intro-title',
    title: 'FABRIC EMPIRES',
    subtitle: 'Learn Fabric. Learn as a family.',
    centre: home,
    radius: 7.5,
    fromHeight: 3.2,
    toHeight: 5.4,
    sweepRad: 0.62,
    startAngleRad: 0.85,
    durationMs: beat('title', 'end'),
  });

  return [forge, build, dawn, rivers, hands, title];
}

/** How long the whole sequence runs, before anyone skips it. */
export function introDurationMs(shots: readonly CinematicShot[]): number {
  return shots.reduce((total, shot) => total + shot.durationMs, 0);
}
