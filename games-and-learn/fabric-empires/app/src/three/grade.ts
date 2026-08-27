/**
 * The grade.
 *
 * Tone mapping is not a grade. `ACESFilmicToneMapping` decides how a very
 * bright scene is squeezed into a screen; it does not decide what the picture
 * should look like once it is there. Everything below is the second question,
 * and it is answered against measurements rather than against taste.
 *
 * ⚠️ **The targets came from a photograph, not from an opinion.** A photoreal
 * aerial of the same kind of country was generated with Sora 2 and measured
 * next to the game's own frames (three of each, so a number that moves with
 * the framing can be told from one that does not). Three differences were
 * large and stable:
 *
 *   | | game | photograph |
 *   | --- | --- | --- |
 *   | mean saturation | 0.433 | 0.245 |
 *   | darkest 5 percent | 0.193 | 0.072 |
 *   | saturation kept at distance | 0.92 | 0.68 |
 *
 * The third is the atmosphere and is fixed with fog rather than here. The
 * first two are this file: the game was nearly twice as colourful as a
 * photograph and had no true blacks in it at all, which together are most of
 * what reads as "rendered" rather than "photographed".
 *
 * ⚠️ The targets are approached, not matched. The photographic reference is a
 * low sun over dark heath and its median luminance is 0.185; grading a game
 * to that would produce a picture nobody can play. The point of the numbers
 * is direction and magnitude, and to stop the dials being set by whoever
 * looked at the screen last.
 */

import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Vector2 } from 'three';

export interface Grade {
  readonly pass: ShaderPass;
  /**
   * Lean the grade further while a cinematic is on screen.
   *
   * Deeper vignette and a touch more contrast, which is the difference
   * between a game rendering a landscape and a camera photographing one. Kept
   * modest: a cinematic that looks like a different game is a cut, not a shot.
   */
  setCinematic(on: boolean): void;
  setSize(width: number, height: number): void;
  /** Advance the grain. Called once a frame with seconds. */
  tick(seconds: number): void;
}

/** Ordinary play. */
const BASE = {
  saturation: 0.66,
  contrast: 1.13,
  lift: 0.055,
  vignette: 0.26,
};

/** During a film. */
const CINEMA = {
  saturation: 0.62,
  contrast: 1.18,
  lift: 0.07,
  vignette: 0.42,
};

/** How fast the look changes between the two, in units per second. */
const BLEND_PER_SECOND = 2.5;

export function createGrade(width = 1, height = 1): Grade {
  const pass = new ShaderPass({
    name: 'GradeShader',
    uniforms: {
      tDiffuse: { value: null },
      resolution: { value: new Vector2(width, height) },
      time: { value: 0 },
      saturation: { value: BASE.saturation },
      contrast: { value: BASE.contrast },
      lift: { value: BASE.lift },
      vignette: { value: BASE.vignette },
      grain: { value: 0.02 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 resolution;
      uniform float time;
      uniform float saturation;
      uniform float contrast;
      uniform float lift;
      uniform float vignette;
      uniform float grain;
      varying vec2 vUv;

      // Cheap hash. Good enough for grain, which wants to look random rather
      // than be random.
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;

        // Contrast about a pivot near the measured median, so the picture
        // pivots around its own midtone instead of around 0.5, which would
        // darken everything as a side effect of adding contrast.
        c = (c - 0.42) * contrast + 0.42;

        // The black point. The measured darkest five percent sat at 0.193
        // against a photograph's 0.072: the scene had no blacks, only dark
        // greys, and dark grey is the colour of fog on a lens.
        c = max(vec3(0.0), c - lift) / max(1.0 - lift, 1e-3);

        // Saturation, on luminance so hues do not shift as they desaturate.
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, saturation);

        // Vignette. Real lenses lose light at the corners; the amount here is
        // less than most real ones do.
        float d = distance(vUv, vec2(0.5));
        c *= 1.0 - vignette * smoothstep(0.34, 0.86, d);

        // Grain, on top of everything, so it is not smoothed away by the
        // antialiasing pass the way it would be earlier in the chain.
        float g = hash(vUv * resolution + fract(time) * 1000.0);
        c += (g - 0.5) * grain;

        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }
    `,
  });

  const u = pass.uniforms;
  // 0 is ordinary play, 1 is a cinematic. Held as a number rather than a flag
  // so the change can be walked rather than cut.
  let want = 0;
  let now = 0;

  const apply = (): void => {
    const t = now;
    u.saturation!.value = BASE.saturation + (CINEMA.saturation - BASE.saturation) * t;
    u.contrast!.value = BASE.contrast + (CINEMA.contrast - BASE.contrast) * t;
    u.lift!.value = BASE.lift + (CINEMA.lift - BASE.lift) * t;
    u.vignette!.value = BASE.vignette + (CINEMA.vignette - BASE.vignette) * t;
  };

  return {
    pass,

    setCinematic(on) {
      want = on ? 1 : 0;
    },

    setSize(w, h) {
      (u.resolution!.value as Vector2).set(w, h);
    },

    tick(seconds) {
      u.time!.value += seconds;
      if (now !== want) {
        const step = BLEND_PER_SECOND * seconds;
        now = want > now ? Math.min(want, now + step) : Math.max(want, now - step);
        apply();
      }
    },
  };
}
