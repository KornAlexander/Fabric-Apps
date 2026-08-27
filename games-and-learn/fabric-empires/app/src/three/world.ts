/**
 * The 3D world: renderer, sky, light, post-processing.
 *
 * Realism here comes from lighting and response to light, not from assets.
 * The four things doing almost all of the work are a physically plausible
 * sky used as an environment map, a single strong sun with soft shadows,
 * ground-truth ambient occlusion, and filmic tone mapping. Everything else
 * is detail on top of those.
 */

import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  MathUtils,
  PCFSoftShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { createGrade, type Grade } from './grade.js';

/**
 * How thick the air is.
 *
 * ⚠️ **Tuned against a measurement, not by eye.** The target is the ratio a
 * photograph shows between the saturation of the ground at the horizon and
 * the ground at your feet, which measured 0.68 across three frames of a
 * photoreal aerial. The game measured 0.92, meaning no atmosphere at all.
 * `FogExp2` reaches roughly half strength at `1 / density` units, so at this
 * value the far side of an island about 78 units in radius is meaningfully
 * hazed and the tiles under the cursor are not.
 */
const FOG_DENSITY = 0.006;

/**
 * How much haze sits between the camera and something `distance` away.
 *
 * `FogExp2`'s own falloff, exported so it can be tested. ⚠️ The bug this
 * exists to prevent is not a wrong-looking number, it is a *plausible*
 * number expressed in a unit the world never reaches: the previous setting
 * was a linear fog from 150 to 900 units across a map about 78 units in
 * radius, so it read as deliberate and delivered under one percent haze at
 * the far shore.
 */
export function hazeAt(distance: number, density = FOG_DENSITY): number {
  const d = distance * density;
  return 1 - Math.exp(-d * d);
}

export { FOG_DENSITY };

export interface WorldQuality {
  /** Off on weak hardware: ambient occlusion is the most expensive pass. */
  readonly ambientOcclusion: boolean;
  readonly bloom: boolean;
  readonly antialias: boolean;
  readonly shadowMapSize: number;
  /** Upper bound on device pixel ratio. Above 2 the cost is not repaid. */
  readonly maxPixelRatio: number;
}

export const HIGH_QUALITY: WorldQuality = {
  ambientOcclusion: true,
  bloom: true,
  antialias: true,
  shadowMapSize: 4096,
  maxPixelRatio: 2,
};

export const LOW_QUALITY: WorldQuality = {
  ambientOcclusion: false,
  bloom: false,
  antialias: false,
  shadowMapSize: 1024,
  maxPixelRatio: 1,
};

export interface World {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly sun: DirectionalLight;
  /** Point the sun shadow frustum at a world-space box of this half-extent. */
  fitShadows(centre: Vector3, halfExtent: number): void;
  /** Move the sun. Elevation and azimuth are degrees. */
  setSunAngle(elevationDeg: number, azimuthDeg: number): void;
  setSize(width: number, height: number): void;
  render(): void;
  /**
   * Compile every visible material now, while a menu is still on screen.
   *
   * three.js builds a program the first time it actually draws with it, so a
   * material that has not been on camera yet compiles during the frame it
   * first appears. Measured on this scene: after real frames of play,
   * `compileAsync` still had **13 programs** left to build, so that work was
   * demonstrably being deferred into gameplay.
   *
   * ⚠️ What is NOT claimed: that any of those 13 land during a battle. An
   * attempt to stage a fight and watch the count produced a clean zero that
   * turned out to mean the fight never started, which is not evidence of
   * anything. The pooled combat meshes are added visible with `count = 0`, so
   * they are plausibly warm already. This is worth doing because moving 13
   * compiles onto the loading screen is free, not because a hitch was proven.
   */
  prewarm(): Promise<void>;
  /**
   * Lean the grade while a film is on screen.
   *
   * Walked over about half a second rather than cut, because a grade that
   * snaps is a cut and the cinematics are meant to be one continuous move.
   */
  setCinematic(on: boolean): void;
  setQuality(quality: WorldQuality): void;
  dispose(): void;
}

export function createWorld(canvas: HTMLCanvasElement, quality = HIGH_QUALITY): World {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false, // SMAA does this in the composer, and does it cheaper.
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.maxPixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  // Set against a measured histogram, not by eye. The scattering sky is a
  // genuine HDR source whose radiance runs into the hundreds near the sun,
  // and at the first plausible-looking value 55 percent of the frame was
  // clipped to pure white. Exposure here is a property of the sky, not of
  // how bright the ground is supposed to look.
  renderer.toneMappingExposure = 0.78;

  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.5, 2400);
  camera.position.set(0, 42, 46);

  // Sky ------------------------------------------------------------------
  //
  // Rayleigh and Mie scattering, evaluated in a shader. No asset, and it
  // reacts correctly when the sun moves, which a static gradient cannot.
  //
  // The scale has to stay inside the camera far plane. A sky box larger than
  // the frustum is clipped away and the horizon turns into whatever the
  // clear colour happens to be.
  const sky = new Sky();
  sky.scale.setScalar(1800);
  const skyUniforms = sky.material.uniforms;
  skyUniforms.turbidity!.value = 3.2;
  skyUniforms.rayleigh!.value = 3.0;
  skyUniforms.mieCoefficient!.value = 0.004;
  skyUniforms.mieDirectionalG!.value = 0.8;
  scene.add(sky);

  /**
   * Dim the sky's rendered radiance.
   *
   * The sky and the ground want different exposures, which is a problem when
   * there is only one. Exposed for the ground, the sky clips over a sixth of
   * the frame to pure white; exposed for the sky, the land is a silhouette.
   * Scaling the sky's own output decouples the two, and it is honest: a real
   * camera photographing a landscape does the same thing with a graduated
   * filter. The environment bake happens before this runs, so the light the
   * sky contributes is unaffected.
   */
  sky.material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      'gl_FragColor = vec4( texColor * 0.26, 1.0 );',
    );
  };

  // Exposure and sun intensity are two ends of one dial: lowering exposure
  // while raising the sun dims the sky relative to the ground, which is the
  // only way to stop a scattering sky clipping without leaving the land in
  // the dark.
  const sun = new DirectionalLight(0xffe9c8, 8.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  // Tuned for a low sun. At grazing angles the depth gradient across a
  // shadow-map texel is large, and a bias set at noon leaves hard dark
  // ribbons of self-shadowing running along every slope in the afternoon.
  // Normal bias, which offsets the lookup along the surface normal, is the
  // one that actually fixes it; depth bias alone just moves the artefact.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.09;
  scene.add(sun);
  scene.add(sun.target);

  /**
   * Ambient fill, as an explicit light rather than as image-based lighting.
   *
   * The sky is kept as an environment map for reflections, but its intensity
   * is turned almost all the way down, because a scattering sky is far
   * brighter as an irradiance source than it looks on screen. At an
   * environment intensity that seemed conservative it still beat a sun of
   * 5.2 by more than two to one, and every surface in the game rendered the
   * colour of the sky: a green island came out uniformly blue.
   *
   * The replacement fill has to stay small for the same reason. Measured by
   * A/B on a fixed patch of ground, dropping this light from 2.2 to nothing
   * raised the measured colour saturation of the ground from 0.15 to 0.28.
   * Fill light is flat and untinted by definition, so every unit of it is a
   * unit of colour removed from the scene. Enough to keep shadows from going
   * black, and no more.
   */
  const fill = new HemisphereLight(0xa8c8ee, 0x6b5a42, 1.75);
  scene.add(fill);

  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const sunDirection = new Vector3();

  function setSunAngle(elevationDeg: number, azimuthDeg: number): void {
    const phi = MathUtils.degToRad(90 - elevationDeg);
    const theta = MathUtils.degToRad(azimuthDeg);
    sunDirection.setFromSphericalCoords(1, phi, theta);
    skyUniforms.sunPosition!.value.copy(sunDirection);

    // Position is a placeholder until fitShadows places the light relative
    // to whatever the camera is looking at.
    sun.position.copy(sunDirection).multiplyScalar(120);

    // The sky is the environment map, so it has to be re-baked whenever the
    // sun moves or the ambient light stops matching the visible sky. The sky
    // is moved into a throwaway scene for the bake: PMREMGenerator expects a
    // scene root, and handing it a bare mesh is undefined behaviour that
    // happens to work until it does not.
    const previous = scene.environment;
    const bakeScene = new Scene();
    bakeScene.add(sky);
    const target = pmrem.fromScene(bakeScene, 0.04);
    scene.add(sky);
    scene.environment = target.texture;
    // Kept only for specular reflections, most visibly on the water and on
    // the metal of the units. As a diffuse source it is turned off in all
    // but name; the hemisphere light does that job predictably.
    scene.environmentIntensity = 0.03;
    previous?.dispose();

    /*
     * Aerial perspective.
     *
     * ⚠️ **This was already here and was doing nothing, which is worse than
     * not being here.** It was a linear fog from 150 to 900 units. The map is
     * about 78 units in radius, so the entire playable world sits inside the
     * fog's near plane and never received a single unit of haze: measured,
     * the game kept 0.92 of its saturation from the foreground to the
     * horizon, where a photograph of real country keeps 0.68. The setting
     * existed, read as deliberate, and had been tuned in a unit the world
     * does not reach.
     *
     * Exponential-squared rather than linear, because that is what air
     * actually does, and because a linear ramp has a visible start.
     *
     * The colour is pale and weakly saturated on purpose. Haze is scattered
     * skylight, so it is bright: the old colour was a mid blue at lightness
     * 0.44, which darkened the distance instead of washing it out, and dark
     * distance reads as a storm rather than as depth.
     */
    const warmth = MathUtils.clamp(elevationDeg / 45, 0, 1);
    const fogColour = new Color().setHSL(
      0.58 - 0.04 * (1 - warmth),
      0.16,
      0.74 - 0.1 * (1 - warmth),
    );
    scene.fog = new FogExp2(fogColour.getHex(), FOG_DENSITY);
  }

  /**
   * Default sun: mid-afternoon rather than noon.
   *
   * The azimuth is not a free choice. The opening camera sits on the +Z side
   * looking back at the origin, and an early version put the sun at 145
   * degrees, behind the island: the establishing shot of the whole game was
   * a backlit silhouette lit only by sky.
   *
   * The elevation is not free either, for the opposite reason. A high sun
   * casts almost no shadow, and shadow is how a viewer reads relief on a
   * screen. Dropping it to the low thirties roughly doubles the length of
   * every shadow on the map and is the single cheapest thing that makes the
   * terrain look three-dimensional.
   */
  setSunAngle(36, 34);

  // Post-processing ------------------------------------------------------
  let composer = new EffectComposer(renderer);
  let gtao: GTAOPass | undefined;
  const grade: Grade = createGrade();
  let lastRenderAt = performance.now();

  function buildComposer(q: WorldQuality): void {
    composer.dispose();
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    if (q.ambientOcclusion) {
      const size = renderer.getSize(new Vector2());
      gtao = new GTAOPass(scene, camera, size.x, size.y);
      // Contact shadows at roughly a metre. Larger radii start darkening
      // whole valleys, which reads as dirt rather than as occlusion.
      gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.6, thickness: 1.2, scale: 1.1 });
      gtao.blendIntensity = 0.85;
      composer.addPass(gtao);
    } else {
      gtao = undefined;
    }

    composer.addPass(new OutputPass());

    // Bloom runs AFTER tone mapping, which is not where the three.js example
    // puts it. It has to here: the scattering sky is a real HDR source whose
    // radiance near the horizon is in the hundreds, and blooming that in HDR
    // smears a white sheet over the entire frame. Blooming the tone-mapped
    // image costs a little accuracy in the glow falloff and is the
    // difference between a lit scene and an unusable one.
    if (q.bloom) {
      const bloom = new UnrealBloomPass(
        renderer.getSize(new Vector2()),
        0.34, // strength
        0.5, // radius
        0.86, // threshold, in tone-mapped 0..1 terms
      );
      composer.addPass(bloom);
    }

    if (q.antialias) composer.addPass(new SMAAPass());

    /*
     * The grade goes last, after antialiasing.
     *
     * ⚠️ Order matters for exactly one of its jobs. Contrast and saturation
     * would be happy anywhere after tone mapping, but grain put before SMAA
     * is grain SMAA then smooths away, leaving the cost and none of the
     * effect.
     */
    const size = renderer.getSize(new Vector2());
    grade.setSize(size.x, size.y);
    composer.addPass(grade.pass);
  }

  buildComposer(quality);

  function setSize(width: number, height: number): void {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    grade.setSize(width, height);
  }

  return {
    renderer,
    scene,
    camera,
    sun,

    fitShadows(centre, halfExtent) {
      /**
       * A directional shadow camera is an orthographic camera sitting at the
       * light, and its depth precision is spread evenly across near to far.
       * The first version parked the light 220 units from the world origin
       * with a near of 1 and a far of 600, which spread the entire depth
       * buffer across six hundred units to resolve terrain occupying about
       * six. Every surface then compared as farther than the depth map said
       * and the whole island rendered as if it were in shadow.
       *
       * So the light is placed relative to what is being looked at, and near
       * and far are wrapped around the scene rather than around the world.
       */
      const distance = halfExtent * 2 + 20;
      sun.position.copy(sunDirection).multiplyScalar(distance).add(centre);
      sun.target.position.copy(centre);
      sun.target.updateMatrixWorld();

      const shadow = sun.shadow.camera;
      shadow.left = -halfExtent;
      shadow.right = halfExtent;
      shadow.top = halfExtent;
      shadow.bottom = -halfExtent;
      shadow.near = Math.max(0.5, distance - halfExtent * 1.6);
      shadow.far = distance + halfExtent * 1.6;
      shadow.updateProjectionMatrix();
    },

    setSunAngle,
    setSize,

    render() {
      // Real seconds, so the grain and the cinematic blend run at the same
      // rate on a slow machine as on a fast one.
      const at = performance.now();
      grade.tick(Math.min(0.1, (at - lastRenderAt) / 1000));
      lastRenderAt = at;
      composer.render();
    },

    async prewarm() {
      // ⚠️ `compile` walks traverseVisible, so anything parked under an
      // invisible parent is not covered by this and will still compile on the
      // frame it is shown. Pools that want warming must be in the scene and
      // visible, which is what combatFx already does with `count = 0`.
      await renderer.compileAsync(scene, camera);
    },

    setCinematic(on) {
      grade.setCinematic(on);
    },

    setQuality(next) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, next.maxPixelRatio));
      sun.shadow.mapSize.set(next.shadowMapSize, next.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      buildComposer(next);
      setSize(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    },

    dispose() {
      composer.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
