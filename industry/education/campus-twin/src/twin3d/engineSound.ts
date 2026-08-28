/**
 * The engine note for the cheat car. Synthesised, never a file.
 *
 * ⚠️ NO AUDIO ASSET, AND THAT IS A DELIBERATE CONSTRAINT RATHER THAN A SHORTCUT. A recorded engine
 * is somebody's recording: a sample of a real car carries a licence, and this app ships as a
 * public template with a `check:publishable` gate that exists to stop exactly that kind of thing
 * arriving by accident. Two oscillators and a filter are nobody's property, cost no bytes in the
 * bundle, and can be tied to the vehicle's actual progress in a way a loop cannot.
 *
 * ⚠️ AND IT IS SILENT UNTIL A KEY IS PRESSED. Browsers refuse to start an AudioContext without a
 * user gesture, which is a rule worth agreeing with rather than working around: an app that makes
 * noise at somebody who merely opened it is the reason the rule exists. The cheat word IS the
 * gesture, so the context is created at that moment and never before.
 */

export interface EngineSound {
  /** Ramp up and hold. `intensity` 0..1 drives revs. */
  start(): void;
  /** 0..1, where 1 is flat out. Cheap enough to call every frame. */
  setLoad(intensity: number): void;
  /** Ramp down and release. Safe to call when not started. */
  stop(): void;
  dispose(): void;
}

type Ctor = typeof AudioContext;

function audioContextCtor(): Ctor | null {
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * ⚠️ Returns a working no-op when audio is unavailable rather than throwing.
 *
 * Server-side rendering, a locked-down browser and a test runner all lack `AudioContext`, and a
 * cheat code that throws in jsdom would take the whole scene down with it. A silent car is a
 * disappointment; a crashed twin is a bug.
 */
export function createEngineSound(): EngineSound {
  const Ctor = audioContextCtor();
  if (!Ctor) {
    return { start() {}, setLoad() {}, stop() {}, dispose() {} };
  }

  let ctx: AudioContext | null = null;
  let osc: OscillatorNode | null = null;
  let sub: OscillatorNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let gain: GainNode | null = null;

  const now = () => ctx?.currentTime ?? 0;

  return {
    start() {
      if (osc) return;
      ctx = ctx ?? new Ctor();
      // Autoplay policy: a context created during a keydown starts `running`, but resume() is
      // free and covers the case where it was suspended by a previous page interaction.
      void ctx.resume();

      gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now());
      gain.gain.exponentialRampToValueAtTime(0.16, now() + 0.25);

      // A sawtooth through a moving low-pass is the classic engine approximation: the harmonics
      // are already there, and opening the filter with the revs is what makes it sound like it is
      // working rather than like a tone that changed pitch.
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(500, now());
      filter.Q.value = 6;

      osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(70, now());

      // A second oscillator a shade off the first beats against it, which is what stops a single
      // saw sounding like a doorbell.
      sub = ctx.createOscillator();
      sub.type = 'square';
      sub.frequency.setValueAtTime(34, now());

      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      sub.start();
    },

    setLoad(intensity) {
      if (!ctx || !osc || !sub || !filter) return;
      const load = Math.min(Math.max(intensity, 0), 1);
      const t = now();
      // Ramps rather than instant sets: a per-frame `setValueAtTime` on a frequency produces
      // zipper noise, which is audible and sounds like a fault rather than like an engine.
      osc.frequency.linearRampToValueAtTime(70 + load * 260, t + 0.08);
      sub.frequency.linearRampToValueAtTime(34 + load * 120, t + 0.08);
      filter.frequency.linearRampToValueAtTime(500 + load * 3200, t + 0.08);
    },

    stop() {
      if (!ctx || !gain || !osc || !sub) return;
      const t = now();
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      // ⚠️ STOPPED AFTER THE FADE, NOT WITH IT. Stopping an oscillator mid-amplitude produces a
      // click, which is the one artefact people always notice.
      const endingOsc = osc;
      const endingSub = sub;
      endingOsc.stop(t + 0.45);
      endingSub.stop(t + 0.45);
      osc = null;
      sub = null;
      gain = null;
      filter = null;
    },

    dispose() {
      this.stop();
      void ctx?.close();
      ctx = null;
    },
  };
}
