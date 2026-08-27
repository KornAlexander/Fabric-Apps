import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createFlyControls, type FlyControls } from './flyControls';

import { HQ10, HQ100, HQ200_EXTRAPOLATED } from '@/data/facts';
import { loadBuildings, type BuildingLayer } from './buildings';
import { HAZE_COLOUR } from './haze';
import { loadVegetation, type VegetationLayer } from './vegetation';

import {
  easeInOutCubic,
  liftForDistance,
  sampleFlight,
  type Viewpoint,
} from './cameraFlight';
import { isFacingNorth, normaliseAngle, shortestTurnToNorth } from './compass';
import { resolveBuildingChainage } from './chainage';
import {
  DetailTileCache,
  chooseDetailTile,
  detailKey,
  groundFocusPoint,
  loadDrapeDetailManifest,
  screenMetresPerPixel,
  type DetailChoice,
} from './drapeDetail';
import { buildSteadyWseProfile, buildWseProfile, peakDischargeForScenario } from './hydrograph';
import { createTerrainMaterial } from './terrainMaterial';
import {
  createHazardWseTexture,
  createWseTexture,
  loadTerrain,
  type ProgressReporter,
  type TerrainAssets,
} from './terrainLoader';

/** Where one village sits on screen right now, and how far away it is. */
export interface ProjectedPlace {
  id: string;
  name: string;
  /** CSS pixels within the canvas. */
  x: number;
  y: number;
  /** Metres from the camera to the village. */
  distanceM: number;
  /** In front of the camera and inside the viewport. */
  onScreen: boolean;
}

/** A plain camera placement, so React never has to construct a `THREE.Vector3`. */
export interface PlainViewpoint {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

export interface Twin3DHandle {
  /** Set the simulation time, in minutes relative to the peak. */
  setTime(tMinutes: number): void;
  /** Fly the camera to one of the AOI's focus places. */
  focusPlace(placeId: string): void;
  setWaterVisible(visible: boolean): void;
  /** Show or hide the ~390 000 instanced trees — also the cheapest thing to turn off. */
  setVegetationVisible(visible: boolean): void;
  setLanduseVisible(visible: boolean): void;
  /** Show or hide the aerial photograph, which lies over the land cover. */
  setDrapeVisible(visible: boolean): void;
  /** True once an aerial photograph has been built for this AOI and loaded. */
  hasDrape: boolean;
  /**
   * Follow the camera with a high-resolution aerial window, or stop.
   *
   * Separate from `setDrapeVisible` because they answer different questions: whether to show a
   * photograph at all, and how sharp the photograph under the camera should be. The detail tiles
   * are several megabytes each and are never fetched until this is on.
   */
  setDetailEnabled(on: boolean): void;
  /** True when this AOI has been through tools/geodata/fetch_drape_detail.py. */
  hasDetail: boolean;
  /** The detail window currently on screen, for the provenance line. Null when none applies. */
  detailPlaceId(): string | null;
  setHazardVisible(visible: boolean): void;
  /** 1 is true scale. Anything above it is a deliberate, declared distortion. */
  setVerticalExaggeration(factor: number): void;
  /** Peak stage offset in metres, for the Act IV "Scheitel ±" lever. */
  setStageOffset(metres: number): void;
  /** Camera azimuth in radians; 0 means the view is looking north. */
  getHeadingRad(): number;
  /** Turn the view back to north, keeping the target, distance and tilt. */
  faceNorth(): void;
  /** The current camera placement, for saving a story stop. */
  getViewpoint(): PlainViewpoint;
  /** Fly to a saved placement over `durationMs` — slower than a village hop, on purpose. */
  flyToViewpoint(to: PlainViewpoint, durationMs: number): void;
  /**
   * Force the camera into or out of free flight. See `flyControls.ts`.
   *
   * Normally nobody calls this: pressing W A S D takes the camera and letting go gives it back.
   * It exists for the button, and for anything that has to take the camera away — a tour.
   */
  setFreeFly(on: boolean): void;
  /** Whether the viewer currently has the camera. Flips on its own, so also see `onFreeFly`. */
  freeFlyEngaged(): boolean;
  /** Subscribe to the latch, so the UI can follow a mode it did not switch. Null to unsubscribe. */
  onFreeFly(listener: ((engaged: boolean) => void) | null): void;
  /** Current drone cruise speed in m/s, for the readout beside the toggle. */
  freeFlyCruiseMs(): number;
  assets: TerrainAssets;
  /** Chainage point per focus place id — how far down the reach each village sits. */
  placeChainage: Map<string, number>;
  /** Where each village currently sits on screen, for the map labels. */
  projectPlaces(): ProjectedPlace[];
  buildings: BuildingLayer | null;
  dispose(): void;
}

/**
 * Build the flood twin scene.
 *
 * One terrain covers the whole AOI, so the villages are viewpoints on a single valley rather than
 * separate maps. Camera work stays restrained — an oblique view of the valley, and an eased flight
 * when the viewer picks another village so the ground stays continuous underneath. That is
 * orientation, not spectacle: the scrubber is still the interaction that matters (PLAN §2.3, no
 * gamification).
 *
 * Stage comes from the per-chainage rating table in the flow field, not from a single peak stage.
 * See PLAN §6.5 for why that distinction cost an order of magnitude in validation accuracy.
 */
export async function initTwin3D(
  canvas: HTMLCanvasElement,
  aoiId: string,
  onProgress?: ProgressReporter
): Promise<Twin3DHandle> {
  const assets = await loadTerrain(aoiId, '/terrain', onProgress);
  const { terrain, flow } = assets;

  // The manifest is a few kilobytes and decides whether the photorealistic switch exists at all,
  // so it is fetched with the terrain. The TILES it describes are 3–5 MB each and are fetched only
  // once the switch is on — nobody pays for this feature by not using it.
  const detailManifest = await loadDrapeDetailManifest(`/terrain/${aoiId}`);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    // Without this the drawing buffer is cleared after presentation and readPixels always returns
    // zeroes, which makes the flood impossible to assert on. The water IS the product here, so
    // being able to verify it in an automated test is worth the small cost of keeping the buffer.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // The colour the ground fades into, so the far edge of the terrain dissolves rather than ending
  // against a different colour. It used to be stone-100 to match the page, which made the canvas
  // read as an unpainted rectangle with a model sitting on it.
  renderer.setClearColor(HAZE_COLOUR, 1);

  const scene = new THREE.Scene();

  // World units are metres, with the terrain centred on the origin.
  const widthM = terrain.width * terrain.resolutionM;
  const depthM = terrain.height * terrain.resolutionM;

  // Vertical exaggeration, applied to the rendered geometry ONLY. `vTerrainZ` in the shader stays
  // in real metres, so the flood depth, the extent and the validated IoU are untouched by this
  // number — it is purely how the landform reads.
  //
  // The default is 1: true scale, no exaggeration. It was 2.5 once, justified by a comment
  // claiming the valley had "only ~200 m of relief"; the real figure is 429 m, from 88 m on the
  // Ahr at Heimersheim to 517 m on the Eifel plateau. Correcting that took it to 1.5, but any
  // factor above 1 is still a claim about the landform that the survey does not make. The Ahr
  // valley is steep enough on its own, and the point of this app is that its numbers are real.
  //
  // Exaggeration is still available, because a flatter reach or a shallower flood can genuinely
  // need it to be readable — but it is now something the viewer switches on deliberately and is
  // told about, rather than the state they are given without being asked.
  const TRUE_SCALE = 1;
  let verticalExaggeration = TRUE_SCALE;

  const camera = new THREE.PerspectiveCamera(42, 1, 20, 80000);

  // Navigation, matching the digital-twin app: left-drag orbits, wheel zooms, right-drag pans.
  // Damping is the same 0.08, which is what gives it the slow, deliberate feel rather than a
  // twitchy game camera — appropriate here (PLAN §2.3, no gamification).
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.7;
  controls.rotateSpeed = 0.55;
  controls.minDistance = 250;
  controls.maxDistance = 26000;
  // Stop just short of the horizon so the camera cannot drop below the terrain and look up
  // through it, which reads as a rendering fault rather than a viewpoint.
  controls.maxPolarAngle = Math.PI * 0.48;

  /**
   * Where the camera sits to frame one village at valley scale.
   *
   * Framing the whole AOI does not work: the inundated corridor is a few hundred metres wide, so
   * at 13 km it is a couple of pixels and the flood is invisible. The story in §9 Act II is the
   * camera coming down into the valley, and that is also the only distance at which the water
   * reads. Positions come from the terrain metadata, which is generated from the AOI config, so
   * this stays AOI-agnostic (§14 Q2).
   */
  const viewpointFor = (placeId: string, rangeM = 3400): Viewpoint | null => {
    const place =
      terrain.focusPlaces.find((p) => p.id === placeId) ?? terrain.focusPlaces[0];
    if (!place) return null;
    const target = new THREE.Vector3(
      (place.u - 0.5) * widthM,
      place.groundM * verticalExaggeration,
      (place.v - 0.5) * depthM
    );
    // Look down into the valley from the south-east. A shallow angle puts the near hillside in
    // front of the water, which is the one thing the shot has to show.
    const position = new THREE.Vector3(
      target.x + rangeM * 0.45,
      target.y + rangeM * 0.95,
      target.z + rangeM * 0.65
    );
    return { position, target };
  };

  /** Jump straight to a village, with no transition. Used for the opening shot. */
  const frame = (placeId: string, rangeM = 3400) => {
    const view = viewpointFor(placeId, rangeM);
    if (!view) return;
    camera.position.copy(view.position);
    // The controls own the orbit centre, so moving the camera without moving the target would let
    // the next drag snap the view back to wherever the target still was.
    controls.target.copy(view.target);
    controls.update();
  };

  // ── Flying between villages ──────────────────────────────────────────────
  // All three villages sit on one terrain, so cutting between them threw away the one thing that
  // makes that legible: they are places on the same river, a few kilometres apart. An instant jump
  // reads as a different map. Flying keeps the landform continuous under the camera, and the lift
  // in the middle of the arc shows the stretch of valley that connects the two.
  let flight: {
    from: Viewpoint;
    to: Viewpoint;
    liftM: number;
    startedAt: number;
    durationMs: number;
  } | null = null;

  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const flyTo = (placeId: string) => {
    const to = viewpointFor(placeId);
    if (!to) return;

    // Respect the OS setting, and do not animate a move that is not really a move.
    const distanceM = controls.target.distanceTo(to.target);
    if (prefersReducedMotion || distanceM < 50) {
      flight = null;
      camera.position.copy(to.position);
      controls.target.copy(to.target);
      controls.update();
      return;
    }

    flight = {
      from: { position: camera.position.clone(), target: controls.target.clone() },
      to,
      liftM: liftForDistance(distanceM),
      startedAt: performance.now(),
      // Long enough to read as travel over ground, short enough not to make the button feel slow.
      durationMs: 1500,
    };
  };

  // Grabbing the controls cancels the flight rather than fighting it for the camera.
  const cancelFlight = () => {
    flight = null;
    northing = null;
  };
  controls.addEventListener('start', cancelFlight);

  /**
   * Fly to an arbitrary placement, at a caller-chosen pace.
   *
   * `flyTo` above only knows about named villages and always takes 1.5 s, because it is
   * navigation. A saved story needs to travel to a placement that has no name and to do it slowly
   * enough to read as narration, so the duration comes from the caller. The mechanism underneath
   * is deliberately the same one — a second, subtly different flight path would be two things to
   * keep honest.
   */
  const flyToViewpoint = (to: PlainViewpoint, durationMs: number) => {
    const destination: Viewpoint = {
      position: new THREE.Vector3(to.position.x, to.position.y, to.position.z),
      target: new THREE.Vector3(to.target.x, to.target.y, to.target.z),
    };
    // How far the shot travels over the ground — this is what the mid-flight lift is for.
    const groundM = controls.target.distanceTo(destination.target);
    // How much the camera moves at all. Two stops on the same village share a target and differ
    // only in angle, and judging that by the target alone called it "not really a move" and cut.
    const moveM = Math.max(groundM, camera.position.distanceTo(destination.position));
    if (prefersReducedMotion || durationMs <= 0 || moveM < 1) {
      flight = null;
      camera.position.copy(destination.position);
      controls.target.copy(destination.target);
      controls.update();
      return;
    }
    flight = {
      from: { position: camera.position.clone(), target: controls.target.clone() },
      to: destination,
      liftM: liftForDistance(groundM),
      startedAt: performance.now(),
      durationMs,
    };
  };

  /** Where the camera is right now — the half of a bookmark the scene owns. */
  const getViewpoint = (): PlainViewpoint => ({
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
  });

  const advanceFlight = () => {
    if (!flight) return;
    const k = Math.min(1, (performance.now() - flight.startedAt) / flight.durationMs);
    const at = sampleFlight(flight.from, flight.to, flight.liftM, k);
    camera.position.copy(at.position);
    controls.target.copy(at.target);
    if (k >= 1) flight = null;
  };

  /**
   * Turning the view back to north.
   *
   * Kept separate from `flight` because it is a different move: the target, the distance and the
   * tilt all stay exactly where they are, and only the azimuth changes. Reusing the flight path
   * would have re-framed the camera as well, which is not what a compass promises.
   */
  let northing: { from: number; delta: number; startedAt: number; durationMs: number } | null =
    null;
  const spherical = new THREE.Spherical();
  const offset = new THREE.Vector3();

  const headingRad = () => {
    offset.copy(camera.position).sub(controls.target);
    spherical.setFromVector3(offset);
    return normaliseAngle(spherical.theta);
  };

  const setAzimuth = (theta: number) => {
    offset.copy(camera.position).sub(controls.target);
    spherical.setFromVector3(offset);
    spherical.theta = theta;
    offset.setFromSpherical(spherical);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  };

  const faceNorth = () => {
    const from = headingRad();
    const delta = shortestTurnToNorth(from);
    if (isFacingNorth(from)) return;
    if (prefersReducedMotion) {
      setAzimuth(0);
      return;
    }
    flight = null;
    northing = { from, delta, startedAt: performance.now(), durationMs: 700 };
  };

  const advanceNorthing = () => {
    if (!northing) return;
    const k = Math.min(1, (performance.now() - northing.startedAt) / northing.durationMs);
    setAzimuth(northing.from + northing.delta * easeInOutCubic(k));
    if (k >= 1) northing = null;
  };

  const wseTexture = createWseTexture(flow.chainagePoints);

  // The hazard-class boundaries, solved once. Each channel is the water surface a steady
  // discharge of that frequency would stand at, so the fragment shader only has to ask which of
  // the three surfaces the ground lies under.
  const hazardWseTexture = createHazardWseTexture(flow.chainagePoints);
  {
    const boundaries = [HQ10.value, HQ100.value, HQ200_EXTRAPOLATED.value];
    const packed = hazardWseTexture.image.data as Float32Array;
    boundaries.forEach((gaugeDischargeM3s, channel) => {
      const profile = buildSteadyWseProfile({
        gaugeDischargeM3s,
        bedProfileM: flow.bedProfileM,
        ratingDischargeM3s: flow.ratingDischargeM3s,
        ratingStageM: flow.ratingStageM,
      });
      for (let i = 0; i < profile.length; i++) packed[i * 4 + channel] = profile[i];
    });
    hazardWseTexture.needsUpdate = true;
  }

  const material = createTerrainMaterial({
    ...assets,
    wseTexture,
    hazardWseTexture,
    verticalExaggeration,
  });

  // Anisotropic filtering matters more for the drape than for anything else in the scene: it is a
  // photograph lying flat on the ground, so it is almost always viewed at a grazing angle, which
  // is exactly the case isotropic filtering smears into mush.
  if (assets.drapeTexture) {
    assets.drapeTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    assets.drapeTexture.needsUpdate = true;
  }

  // Where the AOI spans more than one flight campaign, each one carries the exponent that makes it
  // render like the reference flight. Empty for a single-flight AOI, which then renders unchanged.
  if (assets.drapeCampaigns.length > 0) {
    const slots = material.uniforms.uCampaigns.value as THREE.Vector3[];
    assets.drapeCampaigns
      .slice(0, slots.length)
      .forEach((c, i) => slots[i].set(c.u0, c.u1, c.gamma));
    material.uniforms.uCampaignCount.value = Math.min(
      assets.drapeCampaigns.length,
      slots.length
    );
    console.info(
      `drape: ${assets.drapeCampaigns.length} flight campaigns, exposure matched ` +
        assets.drapeCampaigns.map((c) => `${c.acquired}\u00d7${c.gamma}`).join(' ')
    );
  }

  // One vertex per render-grid cell is 7.5 M vertices — far too many. A 4x decimation keeps the
  // landform honest at 16 m posting while staying inside the §9.4 budget.
  const segmentsX = Math.floor(terrain.width / 4);
  const segmentsY = Math.floor(terrain.height / 4);
  const geometry = new THREE.PlaneGeometry(widthM, depthM, segmentsX, segmentsY);
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  // Real LoD2 geometry, if it has been generated. The app still works without it, which keeps a
  // fresh clone runnable before the 14 MB building mesh has been built.
  let buildings: BuildingLayer | null = null;
  try {
    buildings = await loadBuildings(aoiId, verticalExaggeration, '/terrain', onProgress, {
      widthM,
      depthM,
    });
    buildings.setDrapeCampaigns(assets.drapeCampaigns);
    scene.add(buildings.mesh);
    console.info(`LoD2: ${buildings.meta.count} buildings`);
  } catch {
    console.info('LoD2 buildings not available — run tools/geodata/build_lod2_mesh.py');
  }

  // Real trees, from DOM1 minus DGM1. Optional in the same way as the buildings: a fresh clone
  // runs without them, it just has bare hillsides.
  let vegetation: VegetationLayer | null = null;
  try {
    vegetation = await loadVegetation(aoiId, verticalExaggeration, '/terrain', onProgress);
    if (vegetation) {
      scene.add(vegetation.group);
      console.info(
        `vegetation: ${vegetation.drawn} trees in ${vegetation.chunks} culling chunks`
      );
    }
  } catch {
    console.info('vegetation not available — run tools/geodata/build_vegetation.py');
  }

  /**
   * Nearest chainage point per building, resolved once from the flow field.
   *
   * −1 means the building sits outside the hydraulically connected area, so no river stage
   * reaches it at any discharge and it never takes a depth.
   */
  const buildingChain = buildings
    ? resolveBuildingChainage(
        buildings.meta.buildings,
        {
          data: assets.chainTexture.image.data as Uint16Array,
          width: flow.width,
          height: flow.height,
          resolutionM: flow.resolutionM,
          notConnected: flow.notConnected,
          chainagePoints: flow.chainagePoints,
        },
        {
          easting: terrain.origin.easting,
          northingTop: terrain.origin.northing + terrain.height * terrain.resolutionM,
        }
      )
    : new Int32Array(0);

  /**
   * Chainage point per focus place, so each village can state when the wave reached *it*.
   *
   * Taken from the place's own position rather than from the median of the buildings grouped
   * under it: the grouping is a nearest-name assignment made offline, and only the four original
   * villages ever had one. Reading the flow field directly gives every place on the map the same
   * answer from the same data, and it is the village centre rather than a centroid of whatever
   * happened to be filed under the name.
   */
  const placeChainage = new Map<string, number>();
  {
    const chainData = assets.chainTexture.image.data as Uint16Array;
    const sample = (col: number, row: number): number => {
      if (col < 0 || row < 0 || col >= flow.width || row >= flow.height) return -1;
      const value = chainData[row * flow.width + col];
      return value === flow.notConnected ? -1 : Math.min(value, flow.chainagePoints - 1);
    };

    for (const place of terrain.focusPlaces) {
      const col = Math.round(place.u * flow.width);
      const row = Math.round(place.v * flow.height);
      let index = sample(col, row);

      // A village centre can sit a cell or two off the connected band — the church is not in the
      // river. Widen the search rather than dropping the place from the timeline.
      for (let radius = 1; index < 0 && radius <= 8; radius++) {
        const found: number[] = [];
        for (let dy = -radius; dy <= radius && found.length === 0; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const candidate = sample(col + dx, row + dy);
            if (candidate >= 0) found.push(candidate);
          }
        }
        if (found.length > 0) {
          found.sort((a, b) => a - b);
          index = found[Math.floor(found.length / 2)];
        }
      }
      if (index >= 0) placeChainage.set(place.id, index);
    }
  }

  // Open on the middle of the reach, so the first view is the valley rather than one end of it.
  // This used to be index 1, which was the second of four villages and became the second of
  // thirteen the moment the list grew.
  const openingPlace = terrain.focusPlaces[Math.floor(terrain.focusPlaces.length / 2)];
  frame(openingPlace?.id ?? terrain.focusPlaces[0]?.id ?? '');

  let stageOffsetM = 0;
  let currentMinutes = -600;

  const applyProfile = () => {
    const profile = buildWseProfile({
      tMinutes: currentMinutes,
      bedProfileM: flow.bedProfileM,
      ratingDischargeM3s: flow.ratingDischargeM3s,
      ratingStageM: flow.ratingStageM,
      peakM3s: peakDischargeForScenario(),
      reachLengthM: flow.riverLengthKm * 1000,
      stageOffsetM,
    });
    (wseTexture.image.data as Float32Array).set(profile);
    wseTexture.needsUpdate = true;

    if (buildings) {
      // Each building takes the water surface at its own chainage point. Depth is what the
      // building experiences, and it is the only thing colour ever encodes.
      const count = buildings.meta.count;
      const depths = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const building = buildings.meta.buildings[i];
        const chain = buildingChain[i];
        depths[i] = chain < 0 ? 0 : Math.max(0, profile[chain] - building.groundElevM);
      }
      buildings.setDepths(depths);
    }
  };
  applyProfile();

  const resize = () => {
    const width = canvas.clientWidth || 1280;
    const height = canvas.clientHeight || 720;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  const clock = new THREE.Clock();

  /**
   * Terrain elevation under a world position, in **drawn** metres, or null off the map.
   *
   * The heightmap is already in memory as the texture the shader samples, so this reads the same
   * array rather than raycasting the mesh — a raycast against the displaced plane every frame to
   * answer "how high am I" would be absurd, and the mesh's displacement *is* this array.
   *
   * Nearest-neighbour and the same `1 - v` row flip as `gridUv()` in the shader: the grid is
   * measured data, and interpolating it would invent elevations the survey never recorded.
   *
   * ⚠️ Multiplied by the current exaggeration, because it is compared against `camera.position.y`
   * and the camera lives in drawn units. Reading the surveyed elevation here would put the drone's
   * idea of the ground below the hill it can see whenever the exaggeration lever is off 1.
   */
  const heightData = assets.heightTexture.image.data as Uint16Array;
  const groundAt = (x: number, z: number): number | null => {
    const u = x / widthM + 0.5;
    const v = z / depthM + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const col = Math.min(terrain.width - 1, Math.round(u * (terrain.width - 1)));
    const row = Math.min(terrain.height - 1, Math.round(v * (terrain.height - 1)));
    const elevationM =
      terrain.heightMinM + heightData[row * terrain.width + col] * terrain.heightScale;
    return elevationM * verticalExaggeration;
  };

  // ---------------------------------------------------------------------------------------------
  // High-resolution aerial detail, following the camera. See src/twin3d/drapeDetail.ts.
  // ---------------------------------------------------------------------------------------------

  // Bound so a disposed texture is never left in a live uniform: a `sampler2D` is still bound when
  // its `uHasDetail` gate is zero, and binding nothing means binding unit 0 — which here is the
  // heightmap. One transparent pixel instead.
  const detailFallback = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  detailFallback.needsUpdate = true;

  let detailEnabled = false;
  let requestedDetail: DetailChoice | null = null;
  let installedDetail: DetailChoice | null = null;

  const detailCache = detailManifest
    ? new DetailTileCache(
        `/terrain/${aoiId}`,
        renderer.capabilities.getMaxAnisotropy(),
        (texture, choice) => {
          installedDetail = choice;
          // Published like `dataset.cam`: which window is live is otherwise only visible as a
          // network request, and a test that watches requests cannot tell a tile that arrived
          // from a tile that arrived and was then discarded by a newer one.
          renderer.domElement.dataset.detail = choice ? `${choice.placeId}:${choice.tier}` : '';
          material.uniforms.uDetail.value = texture ?? detailFallback;
          material.uniforms.uHasDetail.value = texture && choice ? 1 : 0;
          if (choice) {
            const { u0, v0, u1, v1 } = choice.tile.rect;
            (material.uniforms.uDetailRect.value as THREE.Vector4).set(u0, v0, u1, v1);
            material.uniforms.uDetailGamma.value = choice.tile.renderGamma;
          }
          // The roofs take the same window, so a house and the ground it stands on are the same
          // photograph at the same sharpness. Handing them different tiles would be visible.
          buildings?.setDetailTile(texture, choice?.tile.rect ?? null, choice?.tile.renderGamma ?? 1);
        }
      )
    : null;

  /** Cap on the view ray. Past this the whole valley is in frame and no window is worth loading. */
  const DETAIL_MAX_RANGE_M = 20000;
  /** How often the choice is reconsidered. The camera does not teleport; five times a second is
   *  far more than enough, and it keeps two heightmap reads out of the hot path. */
  const DETAIL_INTERVAL_MS = 200;
  let detailDueAt = 0;
  const viewDirection = new THREE.Vector3();

  const updateDetail = (nowMs: number) => {
    if (!detailEnabled || !detailManifest || !detailCache) return;
    if (nowMs < detailDueAt) return;
    detailDueAt = nowMs + DETAIL_INTERVAL_MS;

    camera.getWorldDirection(viewDirection);
    // Two passes: intersect the view with a plane at the camera's own ground height, then again at
    // the ground height where that landed. One pass is not enough in a valley — standing on the
    // plateau and looking down at Altenahr, a plane 300 m too high puts the view centre most of a
    // kilometre short, which is a different village.
    const fallbackPlane = terrain.heightMinM * verticalExaggeration;
    const firstPlane = groundAt(camera.position.x, camera.position.z) ?? fallbackPlane;
    const first = groundFocusPoint(camera.position, viewDirection, firstPlane, DETAIL_MAX_RANGE_M);
    const secondPlane = groundAt(first.x, first.z) ?? firstPlane;
    const hit = groundFocusPoint(camera.position, viewDirection, secondPlane, DETAIL_MAX_RANGE_M);

    const screenMpp = screenMetresPerPixel(hit.rangeM, camera.fov, renderer.domElement.height);
    const viewWidthM = screenMpp * renderer.domElement.width;
    const next = chooseDetailTile(
      detailManifest,
      { u: hit.x / widthM + 0.5, v: hit.z / depthM + 0.5 },
      {
        // ⚠️ Drawing-buffer pixels, not CSS pixels. The renderer runs at up to devicePixelRatio 2,
        // so the same window resolves twice as much on a retina screen and needs a finer tile.
        screenMpp,
        baseMpp: assets.drapeMetresPerPixel,
        viewWidthM,
      },
      requestedDetail
    );
    if (detailKey(next) === detailKey(requestedDetail)) return;
    requestedDetail = next;
    detailCache.request(next);
  };

  let freeFlyListener: ((engaged: boolean) => void) | null = null;
  const fly: FlyControls = createFlyControls({
    camera,
    domElement: renderer.domElement,
    controls,
    groundAt,
    onEngagedChange: (engaged) => {
      // Anything else that drives the camera has to let go, or it fights the keys for it. This is
      // the same reason `cancelFlight` exists for a drag — the viewer touching the camera outranks
      // whatever the app was doing with it.
      if (engaged) {
        flight = null;
        northing = null;
      }
      freeFlyListener?.(engaged);
    },
  });

  let animationHandle = 0;
  let lastFrameMs = performance.now();
  const tick = () => {
    animationHandle = requestAnimationFrame(tick);
    const now = performance.now();
    // Clamped: a backgrounded tab resumes with a delta of several seconds, and an unclamped
    // free-fly step would put the camera outside the AOI in a single frame.
    const dt = Math.min((now - lastFrameMs) / 1000, 0.1);
    lastFrameMs = now;

    if (fly.engaged) {
      fly.update(dt);
    } else {
      advanceFlight();
      advanceNorthing();
      controls.update();
    }
    material.uniforms.uTime.value = clock.getElapsedTime();
    updateDetail(now);
    // Where the camera is, as data.
    //
    // ⚠️ There is no pixel test for "did the camera move". The terrain shader animates `uTime`,
    // so two consecutive frames are never byte-identical and a screenshot comparison can prove
    // that something changed but never that nothing did. A first attempt at testing the drone
    // asserted frame equality while parked and failed against the water shimmer, which looks like
    // a broken camera and is not one. Rounded to the metre so shimmer cannot move it.
    const p = camera.position;
    renderer.domElement.dataset.cam =
      `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`;
    renderer.render(scene, camera);
  };
  tick();

  // Marker the e2e tests can assert on once the first frame has actually been drawn.
  renderer.domElement.dataset.twinReady = 'true';

  return {
    assets,
    placeChainage,
    getHeadingRad: headingRad,
    faceNorth,
    getViewpoint,
    flyToViewpoint,
    freeFlyCruiseMs: () => fly.cruiseMs,
    freeFlyEngaged: () => fly.engaged,
    onFreeFly(listener) {
      freeFlyListener = listener;
    },
    setFreeFly(on: boolean) {
      // Everything this used to do — disabling OrbitControls, adopting the current orientation,
      // deriving an orbit centre on the way back out — now lives in `flyControls.ts`, because it
      // has to happen on a keypress as well as on a click and there must be exactly one copy of it.
      fly.setEngaged(on);
    },
    projectPlaces(): ProjectedPlace[] {
      // Recomputed from the live exaggeration rather than cached: the ground a label sits over
      // moves when the terrain is stretched, and a label that stays put while the hill under it
      // rises is worse than no label.
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      const point = new THREE.Vector3();
      return terrain.focusPlaces.map((place) => {
        point.set(
          (place.u - 0.5) * widthM,
          place.groundM * verticalExaggeration,
          (place.v - 0.5) * depthM
        );
        // Distance first — project() replaces the vector with clip coordinates.
        const distanceM = camera.position.distanceTo(point);
        point.project(camera);
        const x = (point.x * 0.5 + 0.5) * width;
        const y = (-point.y * 0.5 + 0.5) * height;
        return {
          id: place.id,
          name: place.name,
          x,
          y,
          distanceM,
          onScreen: point.z < 1 && x >= 0 && x <= width && y >= 0 && y <= height,
        };
      });
    },
    buildings,
    setTime(tMinutes: number) {
      currentMinutes = tMinutes;
      applyProfile();
    },
    focusPlace(placeId: string) {
      flyTo(placeId);
    },
    setWaterVisible(visible: boolean) {
      material.uniforms.uShowWater.value = visible ? 1 : 0;
    },
    setVegetationVisible(visible: boolean) {
      vegetation?.setVisible(visible);
    },
    setLanduseVisible(visible: boolean) {
      material.uniforms.uShowLanduse.value = visible ? 1 : 0;
    },
    setDrapeVisible(visible: boolean) {
      material.uniforms.uShowDrape.value = visible ? 1 : 0;
    },
    hasDrape: assets.drapeTexture !== null,
    setDetailEnabled(on: boolean) {
      if (on === detailEnabled) return;
      detailEnabled = on;
      if (on) {
        // Choose immediately rather than waiting out the interval: the switch should visibly do
        // something, and the first tile takes a moment to arrive as it is.
        detailDueAt = 0;
        updateDetail(performance.now());
        return;
      }
      requestedDetail = null;
      detailCache?.request(null);
    },
    hasDetail: (detailManifest?.places.length ?? 0) > 0,
    detailPlaceId: () => installedDetail?.placeId ?? null,
    setHazardVisible(visible: boolean) {
      material.uniforms.uShowHazard.value = visible ? 1 : 0;
    },
    setVerticalExaggeration(factor: number) {
      const previous = verticalExaggeration;
      if (factor === previous) return;
      verticalExaggeration = factor;

      material.uniforms.uVerticalExaggeration.value = factor;
      buildings?.setVerticalExaggeration(factor);
      vegetation?.setVerticalExaggeration(factor);

      // Scale the camera with the ground it is looking at. Without this the terrain drops away
      // under a camera that stays put, so switching the factor reads as the view lurching rather
      // than as the landform changing.
      const ratio = factor / previous;
      controls.target.y *= ratio;
      camera.position.y *= ratio;
      controls.update();
    },
    setStageOffset(metres: number) {
      stageOffsetM = metres;
      applyProfile();
    },
    dispose() {
      cancelAnimationFrame(animationHandle);
      controls.removeEventListener('start', cancelFlight);
      controls.dispose();
      // Its listeners are on `window`, so they outlive the canvas unless removed explicitly —
      // and a stale keydown handler would move a camera that no longer exists.
      fly.dispose();
      freeFlyListener = null;
      window.removeEventListener('resize', resize);
      vegetation?.dispose();
      // Up to 67 MB of texture, which the browser does not reclaim on its own when the scene is
      // swapped for another one.
      detailCache?.dispose();
      detailFallback.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
