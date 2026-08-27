/**
 * Screen effects: the layer that makes things feel like they happened.
 *
 * Deliberately separate from the renderers. A renderer answers "what does the
 * world look like right now"; this answers "what just occurred". Keeping them
 * apart means the map can be redrawn lazily while effects animate freely, and
 * an effect can never corrupt game state because it holds none.
 *
 * Everything here is time-based rather than frame-based, so the feel does not
 * change on a slow machine.
 */

import { BASE_HEX_SIZE, type Hex } from '@fabric-empires/engine';

export interface Point {
  x: number;
  y: number;
}

/**
 * How the effects layer finds a hex on screen.
 *
 * Passed in rather than derived from a camera, because the world is now 3D
 * and the projection is a perspective matrix, not a pan and a zoom. The
 * scale is a pixels-per-hex figure so text and rings still shrink with
 * distance.
 */
export interface ScreenProjection {
  project(hex: Hex): Point;
  /** Approximate on-screen pixel size of one hex at that location. */
  scaleAt(hex: Hex): number;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(t: number): number {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

interface Timed {
  readonly start: number;
  readonly duration: number;
}

interface FloatingText extends Timed {
  readonly hex: Hex;
  readonly text: string;
  readonly colour: string;
  readonly scale: number;
  readonly drift: number;
}

interface Pulse extends Timed {
  readonly hex: Hex;
  readonly colour: string;
  readonly maxRadius: number;
  readonly lineWidth: number;
}

interface TileFlash extends Timed {
  readonly hex: Hex;
  readonly colour: string;
}

interface Shake extends Timed {
  readonly magnitude: number;
}

interface UnitMotion extends Timed {
  readonly unitId: string;
  readonly from: Hex;
  readonly to: Hex;
  readonly kind: 'travel' | 'lunge';
  resolve?: (() => void) | undefined;
}

interface UnitFade extends Timed {
  readonly unitId: string;
}

export interface EffectsSystem {
  /** A number or word that rises and fades above a tile. */
  floatingText(hex: Hex, text: string, colour: string, scale?: number): void;
  /** An expanding ring, for impacts and arrivals. */
  pulse(hex: Hex, colour: string, maxRadiusFactor?: number): void;
  /** A brief wash of colour over one tile. */
  flash(hex: Hex, colour: string, durationMs?: number): void;
  /** Camera kick. Magnitude is in screen pixels at zoom 1. */
  shake(magnitude: number): void;
  /** Slide a unit from one hex to another. Resolves when it lands. */
  travel(unitId: string, from: Hex, to: Hex, durationMs?: number): Promise<void>;
  /** Throw a unit at a neighbour and back. Resolves at the moment of impact. */
  lunge(unitId: string, from: Hex, toward: Hex): Promise<void>;
  /** Dissolve a unit that has died. */
  dissolve(unitId: string): void;

  /** World-space pixel offset to draw a unit at, if it is moving. */
  offsetOf(unitId: string): Point | undefined;
  /** Opacity to draw a unit at, if it is dissolving. */
  opacityOf(unitId: string): number;
  /** Current camera shake offset in screen pixels. */
  shakeOffset(): Point;

  /** Advance to `now`. Returns true if anything still needs drawing. */
  update(now: number): boolean;
  /** True while any effect is running. */
  active(): boolean;
  draw(ctx: CanvasRenderingContext2D, projection: ScreenProjection): void;
}

export function createEffects(): EffectsSystem {
  const texts: FloatingText[] = [];
  const pulses: Pulse[] = [];
  const flashes: TileFlash[] = [];
  const shakes: Shake[] = [];
  const motions = new Map<string, UnitMotion>();
  const fades = new Map<string, UnitFade>();

  let now = performance.now();

  const progress = (t: Timed): number =>
    Math.min(1, Math.max(0, (now - t.start) / t.duration));

  function prune<T extends Timed>(list: T[]): void {
    for (let i = list.length - 1; i >= 0; i--) {
      if (progress(list[i]!) >= 1) list.splice(i, 1);
    }
  }

  return {
    floatingText(hex, text, colour, scale = 1) {
      texts.push({
        hex,
        text,
        colour,
        scale,
        drift: (Math.random() - 0.5) * 18,
        start: now,
        duration: 1100,
      });
    },

    pulse(hex, colour, maxRadiusFactor = 1.6) {
      pulses.push({
        hex,
        colour,
        maxRadius: BASE_HEX_SIZE * maxRadiusFactor,
        lineWidth: 3,
        start: now,
        duration: 520,
      });
    },

    flash(hex, colour, durationMs = 320) {
      flashes.push({ hex, colour, start: now, duration: durationMs });
    },

    shake(magnitude) {
      shakes.push({ magnitude, start: now, duration: 380 });
    },

    travel(unitId, from, to, durationMs = 260) {
      return new Promise<void>((resolve) => {
        motions.set(unitId, {
          unitId,
          from,
          to,
          kind: 'travel',
          start: now,
          duration: durationMs,
          resolve,
        });
      });
    },

    lunge(unitId, from, toward) {
      return new Promise<void>((resolve) => {
        motions.set(unitId, {
          unitId,
          from,
          to: toward,
          kind: 'lunge',
          start: now,
          duration: 340,
          // Resolve at the strike, not at the recovery, so damage lands on
          // the frame the two units actually meet.
          resolve,
        });
      });
    },

    dissolve(unitId) {
      fades.set(unitId, { unitId, start: now, duration: 420 });
    },

    offsetOf(unitId) {
      const motion = motions.get(unitId);
      if (!motion) return undefined;
      const t = progress(motion);

      const fromPixel = {
        x: Math.sqrt(3) * motion.from.q + (Math.sqrt(3) / 2) * motion.from.r,
        y: 1.5 * motion.from.r,
      };
      const toPixel = {
        x: Math.sqrt(3) * motion.to.q + (Math.sqrt(3) / 2) * motion.to.r,
        y: 1.5 * motion.to.r,
      };
      const dx = (toPixel.x - fromPixel.x) * BASE_HEX_SIZE;
      const dy = (toPixel.y - fromPixel.y) * BASE_HEX_SIZE;

      if (motion.kind === 'travel') {
        const e = easeInOutQuad(t);
        // Drawn relative to the unit's CURRENT hex, which the engine has
        // already moved, so the offset runs from behind to zero.
        return { x: -dx * (1 - e), y: -dy * (1 - e) };
      }

      // Lunge: out to 45 percent of the way, then snap back.
      const out = t < 0.45 ? easeOutBack(t / 0.45) : 1 - easeOutCubic((t - 0.45) / 0.55);
      return { x: dx * 0.45 * out, y: dy * 0.45 * out };
    },

    opacityOf(unitId) {
      const fade = fades.get(unitId);
      if (!fade) return 1;
      return 1 - progress(fade);
    },

    shakeOffset() {
      let x = 0;
      let y = 0;
      for (const s of shakes) {
        const t = progress(s);
        const decay = (1 - t) * (1 - t);
        // Two different frequencies so it reads as a jolt rather than a hum.
        x += Math.sin((now - s.start) * 0.09) * s.magnitude * decay;
        y += Math.cos((now - s.start) * 0.13) * s.magnitude * decay * 0.6;
      }
      return { x, y };
    },

    update(next) {
      now = next;

      for (const [id, motion] of motions) {
        const t = progress(motion);
        // A lunge resolves at the strike; a travel resolves on arrival.
        const resolveAt = motion.kind === 'lunge' ? 0.45 : 1;
        if (t >= resolveAt && motion.resolve) {
          motion.resolve();
          motion.resolve = undefined;
        }
        if (t >= 1) motions.delete(id);
      }
      for (const [id, fade] of fades) {
        if (progress(fade) >= 1) fades.delete(id);
      }
      prune(texts);
      prune(pulses);
      prune(flashes);
      prune(shakes);

      return this.active();
    },

    active() {
      return (
        texts.length > 0 ||
        pulses.length > 0 ||
        flashes.length > 0 ||
        shakes.length > 0 ||
        motions.size > 0 ||
        fades.size > 0
      );
    },

    draw(ctx, projection) {
      for (const flash of flashes) {
        const t = progress(flash);
        const centre = projection.project(flash.hex);
        const size = projection.scaleAt(flash.hex);
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.55;
        ctx.fillStyle = flash.colour;
        ctx.beginPath();
        ctx.arc(centre.x, centre.y, size * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      for (const pulse of pulses) {
        const t = progress(pulse);
        const centre = projection.project(pulse.hex);
        const zoom = projection.scaleAt(pulse.hex) / BASE_HEX_SIZE;
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.85;
        ctx.strokeStyle = pulse.colour;
        ctx.lineWidth = Math.max(1, pulse.lineWidth * zoom * (1 - t * 0.6));
        ctx.beginPath();
        ctx.arc(centre.x, centre.y, pulse.maxRadius * zoom * easeOutCubic(t), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      for (const text of texts) {
        const t = progress(text);
        const centre = projection.project(text.hex);
        const size = projection.scaleAt(text.hex);
        const zoom = size / BASE_HEX_SIZE;
        const rise = 46 * zoom * easeOutCubic(t);
        const fontSize = Math.max(13, 20 * zoom * text.scale);
        ctx.save();
        ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
        ctx.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, fontSize * 0.18);
        ctx.strokeStyle = 'rgba(4, 6, 10, 0.85)';
        ctx.lineJoin = 'round';
        ctx.strokeText(text.text, centre.x + text.drift * zoom, centre.y - rise);
        ctx.fillStyle = text.colour;
        ctx.fillText(text.text, centre.x + text.drift * zoom, centre.y - rise);
        ctx.restore();
      }
    },
  };
}
