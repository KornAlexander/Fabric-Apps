/**
 * Cues: the sound the cinematics make.
 *
 * The four in-game films played in silence. This gives each of them a short
 * synthesised phrase, and the word **synthesised** is the whole design.
 *
 * ⚠️ **Nothing here is a file.** D59 says this project ships no assets, and it
 * means it: the terrain, the water, the sky and every object on the map are
 * generated at runtime from the world seed. The two music tracks are the
 * awkward exception, and they had to be kept out of the repository entirely
 * because Suno's free plan licenses its output for non-commercial use only.
 * That is a fine trade for a background score nobody misses, and a bad one
 * here, because it would mean the cinematics are silent in every clone but
 * this machine. A cue built out of oscillators has no licence, weighs nothing,
 * and works in a fresh checkout with no download.
 *
 * The composition is kept as **data** and the synthesis reads it. That split
 * is not tidiness: WebAudio does not exist under test, so the only part of
 * this that can be checked automatically is which note sounds when, and the
 * only way to check it is for that to be a table rather than a hundred
 * imperative calls.
 */

/** The instruments. Four is enough for a four second phrase. */
export type Voice =
  /** A struck bell, with the inharmonic partials that make metal sound like metal. */
  | 'bell'
  /** A drum: a pitch dropping fast under a burst of noise. */
  | 'drum'
  /** Brass-ish. A stack of detuned saws opening through a filter. */
  | 'swell'
  /** A sustained low bed, for dread. */
  | 'drone';

export interface CueEvent {
  /** Seconds from the start of the cue. */
  readonly at: number;
  readonly voice: Voice;
  /** Hertz. Written as notes in the comments, because 233.08 is not readable. */
  readonly hz: number;
  /** How long this voice rings, before the reverb tail. */
  readonly seconds: number;
  /** Relative level, 0 to 1. */
  readonly gain: number;
}

/**
 * ⚠️ **The last note of a cue must start well before its film ends.**
 *
 * The shots run 3.8 to 5.2 seconds. A cue that is still striking bells when
 * the camera cuts back to the map sounds like the game stuttered, so every
 * cue is written to be finished, apart from its tail, by this point. The tail
 * is allowed to ring on over the map; that part sounds deliberate.
 */
export const LAST_ONSET_SECONDS = 3.2;

/*
 * Frequencies, so the tables below read as music rather than as numbers.
 */
const C2 = 65.41;
const G2 = 98.0;
const A2 = 110.0;
const D3 = 146.83;
const E3 = 164.81;
const F3 = 174.61;
const G3 = 196.0;
const C4 = 261.63;
const D5 = 587.33;
const A5 = 880.0;
const D6 = 1174.66;

/**
 * The score for each film.
 *
 * Keyed by the cinematic's `id`, which is what makes the coverage test
 * possible: a new cinematic with no entry here is a test failure rather than
 * a thing somebody notices months later.
 */
export const CUES: Readonly<Record<string, readonly CueEvent[]>> = {
  /*
   * The first workspace. Hopeful, and the only cue in the game that is
   * unambiguously major: a bed, then a rising fifth into the octave, which is
   * about the most optimistic three notes in Western music.
   */
  'first-city': [
    { at: 0.0, voice: 'drone', hz: D3, seconds: 3.6, gain: 0.3 },
    { at: 0.15, voice: 'bell', hz: D5, seconds: 2.6, gain: 0.5 },
    { at: 1.15, voice: 'bell', hz: A5, seconds: 2.4, gain: 0.42 },
    { at: 2.2, voice: 'bell', hz: D6, seconds: 2.6, gain: 0.34 },
  ],

  /*
   * First blood. Low, martial and short: three drum strokes with a dark fifth
   * underneath. No bell, because nothing here is bright.
   */
  'first-blood': [
    { at: 0.0, voice: 'drum', hz: 120, seconds: 0.9, gain: 0.75 },
    { at: 0.3, voice: 'swell', hz: A2, seconds: 2.6, gain: 0.4 },
    { at: 0.32, voice: 'swell', hz: E3, seconds: 2.4, gain: 0.26 },
    { at: 0.62, voice: 'drum', hz: 110, seconds: 0.9, gain: 0.6 },
    { at: 1.5, voice: 'drum', hz: 100, seconds: 1.2, gain: 0.7 },
  ],

  /*
   * The walls change hands. A gong, then two swells a tone apart, the second
   * lower than the first, so the phrase sags. It plays whether the city was
   * won or lost, which is right: both are the same event, and neither is good
   * news for somebody.
   */
  'city-falls': [
    { at: 0.0, voice: 'bell', hz: G2, seconds: 4.2, gain: 0.55 },
    { at: 0.08, voice: 'drum', hz: 90, seconds: 1.3, gain: 0.65 },
    { at: 0.9, voice: 'swell', hz: G3, seconds: 1.6, gain: 0.3 },
    { at: 2.0, voice: 'swell', hz: F3, seconds: 2.0, gain: 0.34 },
  ],

  /*
   * The Proctor. The one cue meant to be unpleasant: a low drone that grows
   * for four seconds under two distant tolls, and no resolution at the end of
   * it. The exam is arriving, not concluding.
   */
  proctor: [
    { at: 0.0, voice: 'drone', hz: C2, seconds: 4.4, gain: 0.42 },
    { at: 1.1, voice: 'bell', hz: C4, seconds: 3.0, gain: 0.3 },
    { at: 2.5, voice: 'bell', hz: C4, seconds: 3.0, gain: 0.36 },
    { at: 3.0, voice: 'swell', hz: G2, seconds: 2.2, gain: 0.34 },
  ],
};

export interface Cues {
  /** Sound the cue for a cinematic. Unknown ids are silence, not an error. */
  play(id: string): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
}

/**
 * Where the sound goes.
 *
 * ⚠️ **Typed as the base context, not `AudioContext`, so a cue can be
 * rendered into an `OfflineAudioContext` and measured.** WebAudio does not
 * exist under test, which means the unit tests can check the composition and
 * can never check that the graph makes a sound at all. Rendering the same
 * code offline in a real browser and looking at the samples is the only
 * honest evidence, and it costs one parameter.
 */
export type ContextFactory = () => BaseAudioContext;

/**
 * The partials of a struck bell.
 *
 * ⚠️ **These ratios are not a harmonic series, and that is the point.** A
 * stack of whole-number multiples sounds like an organ. Metal bars and bells
 * ring at inharmonic ratios, and the 2.76 and 5.40 in particular are what the
 * ear hears as "struck metal" rather than "a tone".
 *
 * Each entry is [ratio, level, how long this partial lasts relative to the
 * whole]. High partials die first, which is what makes a bell soften as it
 * rings instead of just getting quieter.
 */
const BELL_PARTIALS: readonly (readonly [number, number, number])[] = [
  [1.0, 1.0, 1.0],
  [2.0, 0.5, 0.7],
  [2.76, 0.36, 0.5],
  [5.4, 0.18, 0.3],
  [8.93, 0.09, 0.18],
];

/**
 * A room.
 *
 * A dry oscillator sounds like a test tone no matter how well it is
 * orchestrated, and this is roughly fifteen lines: noise decaying over two
 * and a bit seconds, which is a perfectly convincing large stone room. It is
 * the single biggest difference between "a synthesiser" and "a score".
 */
function buildRoom(ctx: BaseAudioContext): ConvolverNode {
  const seconds = 2.4;
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      // Cubic decay is close enough to a real hall and costs one multiply.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3);
    }
  }
  const convolver = ctx.createConvolver();
  convolver.buffer = impulse;
  return convolver;
}

export function createCues(makeContext?: ContextFactory): Cues {
  let ctx: BaseAudioContext | undefined;
  let dry: GainNode | undefined;
  let wet: GainNode | undefined;
  let muted = false;

  /*
   * Built on the first cue rather than at load.
   *
   * ⚠️ An AudioContext created before any user gesture starts suspended and
   * browsers log a warning about it. Every cue is downstream of a click
   * anyway, so waiting costs nothing and keeps the console clean.
   */
  const audio = (): { ctx: BaseAudioContext; dry: GainNode; wet: GainNode } | undefined => {
    if (ctx && dry && wet) return { ctx, dry, wet };
    const build = makeContext ?? (window.AudioContext ? () => new window.AudioContext() : undefined);
    if (!build) return undefined;
    try {
      ctx = build();
    } catch {
      return undefined;
    }
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    dry = ctx.createGain();
    dry.gain.value = 0.82;
    dry.connect(master);

    const room = buildRoom(ctx);
    room.connect(master);
    wet = ctx.createGain();
    wet.gain.value = 0.34;
    wet.connect(room);

    return { ctx, dry, wet };
  };

  /** Send one voice to both the room and the direct path. */
  const send = (node: AudioNode, dryGain: GainNode, wetGain: GainNode): void => {
    node.connect(dryGain);
    node.connect(wetGain);
  };

  function bell(ctx: BaseAudioContext, out: [GainNode, GainNode], e: CueEvent, t0: number): void {
    for (const [ratio, level, span] of BELL_PARTIALS) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = e.hz * ratio;
      const env = ctx.createGain();
      const peak = e.gain * level;
      const life = e.seconds * span;
      env.gain.setValueAtTime(0.0001, t0);
      // A strike is 4 ms, not instant: an instant one clicks.
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + life);
      osc.connect(env);
      send(env, out[0], out[1]);
      osc.start(t0);
      osc.stop(t0 + life + 0.05);
    }
  }

  function drum(ctx: BaseAudioContext, out: [GainNode, GainNode], e: CueEvent, t0: number): void {
    // The body: a pitch falling by two thirds in a quarter of a second, which
    // is what the ear reads as a struck skin rather than a bass note.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(e.hz, t0);
    osc.frequency.exponentialRampToValueAtTime(e.hz * 0.35, t0 + 0.25);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(e.gain, t0 + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + e.seconds);
    osc.connect(env);
    send(env, out[0], out[1]);
    osc.start(t0);
    osc.stop(t0 + e.seconds + 0.05);

    // The stick: a short burst of noise, filtered dark so it reads as a hide
    // drum and not as a snare.
    const noiseSeconds = 0.16;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * noiseSeconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = 'lowpass';
    band.frequency.value = 620;
    const noiseEnv = ctx.createGain();
    noiseEnv.gain.setValueAtTime(e.gain * 0.5, t0);
    noiseEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + noiseSeconds);
    noise.connect(band);
    band.connect(noiseEnv);
    send(noiseEnv, out[0], out[1]);
    noise.start(t0);
  }

  function swell(ctx: BaseAudioContext, out: [GainNode, GainNode], e: CueEvent, t0: number): void {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    // Slow in, slower out. Brass does not start instantly and neither does this.
    env.gain.linearRampToValueAtTime(e.gain, t0 + e.seconds * 0.45);
    env.gain.linearRampToValueAtTime(0.0001, t0 + e.seconds);

    const band = ctx.createBiquadFilter();
    band.type = 'lowpass';
    band.Q.value = 2;
    // The filter opening as it gets louder is what makes it brass rather than
    // an organ getting nearer: real instruments get brighter as they get loud.
    band.frequency.setValueAtTime(e.hz * 2, t0);
    band.frequency.linearRampToValueAtTime(e.hz * 8, t0 + e.seconds * 0.6);
    band.connect(env);

    // Three saws, slightly apart, so it is a section and not one player.
    for (const detune of [-7, 0, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = e.hz;
      osc.detune.value = detune;
      const trim = ctx.createGain();
      trim.gain.value = 0.33;
      osc.connect(trim);
      trim.connect(band);
      osc.start(t0);
      osc.stop(t0 + e.seconds + 0.05);
    }
    send(env, out[0], out[1]);
  }

  function drone(ctx: BaseAudioContext, out: [GainNode, GainNode], e: CueEvent, t0: number): void {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(e.gain, t0 + e.seconds * 0.6);
    env.gain.linearRampToValueAtTime(0.0001, t0 + e.seconds);

    const band = ctx.createBiquadFilter();
    band.type = 'lowpass';
    band.frequency.setValueAtTime(e.hz * 4, t0);
    band.frequency.linearRampToValueAtTime(e.hz * 10, t0 + e.seconds * 0.75);
    band.connect(env);

    // An octave and a hair off, which beats slowly and keeps a long note alive.
    for (const ratio of [1, 2.003]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = e.hz * ratio;
      const trim = ctx.createGain();
      trim.gain.value = ratio === 1 ? 0.6 : 0.25;
      osc.connect(trim);
      trim.connect(band);
      osc.start(t0);
      osc.stop(t0 + e.seconds + 0.05);
    }
    send(env, out[0], out[1]);
  }

  return {
    get muted() {
      return muted;
    },

    setMuted(next) {
      muted = next;
    },

    play(id) {
      if (muted) return;
      const events = CUES[id];
      if (!events || events.length === 0) return;
      const parts = audio();
      if (!parts) return;
      /*
       * Suspended until a gesture, and every cue is downstream of one.
       *
       * ⚠️ Guarded, because an OfflineAudioContext has no `resume` and is
       * exactly what the offline measurement passes in.
       */
      if ('resume' in parts.ctx) {
        void (parts.ctx as AudioContext).resume().catch(() => undefined);
      }

      const out: [GainNode, GainNode] = [parts.dry, parts.wet];
      // A hair in the future, so the first event is scheduled rather than
      // late: anything at exactly currentTime is already behind.
      const start = parts.ctx.currentTime + 0.02;
      for (const event of events) {
        const t0 = start + event.at;
        if (event.voice === 'bell') bell(parts.ctx, out, event, t0);
        else if (event.voice === 'drum') drum(parts.ctx, out, event, t0);
        else if (event.voice === 'swell') swell(parts.ctx, out, event, t0);
        else drone(parts.ctx, out, event, t0);
      }
    },
  };
}
