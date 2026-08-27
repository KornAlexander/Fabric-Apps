/**
 * The 3D presentation of a game state.
 *
 * This is the only place that knows both the engine and three.js. The engine
 * still knows nothing about rendering (D35), and the renderer holds no game
 * state: every frame it is told what the world looks like and reconciles its
 * objects against that.
 *
 * Reconciliation rather than rebuilding matters here. Tearing down and
 * rebuilding every unit each turn would drop the animation state and rebuild
 * geometry for objects that did not change.
 */

import {
  CanvasTexture,
  Color,
  Group,
  MOUSE,
  Material,
  Mesh,
  Object3D,
  Raycaster,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  hexKey,
  hexRound,
  unitType,
  isBreached,
  maxCityHp,
  PLAYER_FACTION_ID,
  type GameMap,
  type GameState,
  type Hex,
  type ReachableTile,
  type SeenCity,
} from '@fabric-empires/engine';
import { createWorld, HIGH_QUALITY, type World, type WorldQuality } from './world.js';
import {
  HEX_RADIUS,
  SEA_LEVEL,
  buildTerrain,
  hexPatch,
  hexRing,
  hexToWorld,
  overlayMaterial,
  worldToAxial,
  type Terrain,
} from './terrain.js';
import { createWater, type WaterSurface } from './water.js';
import { buildScatter, type Scatter } from './scatter.js';
import { createCombatFx, type CombatFx } from './combatFx.js';
import { buildCity, buildRuin, buildUnit, disposeEntityMaterials } from './entities.js';
import { createFlyControls, type FlyTelemetry } from './flyControls.js';
import type { CinematicShot } from './cinematic.js';
import { createCorruption } from './corruption.js';
import { createFog } from './fog.js';

export interface Scene3DView {
  readonly selectedUnitId?: string | undefined;
  readonly reachable?: ReadonlyMap<string, ReachableTile> | undefined;
  readonly attackTargets?: ReadonlySet<string> | undefined;
  /**
   * Tiles proposed as somewhere to found a city, best first.
   *
   * Drawn brightest at the head of the list, so the ranking is visible on the
   * map rather than only in a panel: the point of the advice is that it can be
   * taken without reading anything.
   */
  readonly settleSites?: readonly Hex[] | undefined;
  /**
   * Buried caches the player has already uncovered ground over.
   *
   * ⚠️ **Filtered by the caller, not here.** The scene knows about fog but not
   * about exploration history: a tile can be fogged now and remembered from
   * ten turns ago, and a cache found back then should stay on the map. Passing
   * the list already filtered keeps that judgement in one place.
   */
  readonly treasures?: readonly Hex[] | undefined;
  readonly hover?: Hex | undefined;
  /** World-space display offset for a unit that is mid-animation. */
  readonly unitOffset?: ((unitId: string) => { x: number; z: number } | undefined) | undefined;
  /** 0 while a destroyed unit fades out. */
  readonly unitOpacity?: ((unitId: string) => number) | undefined;
  /**
   * Hexes the player can currently see, if fog is on.
   *
   * ⚠️ Units and cities outside it are not drawn at all, rather than drawn
   * dimmed. Remembered ground shows the hill; it must not show who is standing
   * on the hill now, or scouting would be pointless after the first look.
   * Undefined means no fog, which is what every test and the map editor use.
   */
  readonly visibleHexes?: ReadonlySet<string> | undefined;
  /**
   * Towns the VIEWER remembers, as they looked when last seen.
   *
   * ⚠️ **Handed in rather than read off the state, for the same reason
   * `treasures` is.** Memory is per seat now, and the scene has no idea which
   * seat is looking at it. Reading a faction id out of the state here would
   * make the renderer decide whose fog it is drawing, which is exactly the
   * judgement that belongs in one place in the caller.
   *
   * Undefined means no remembered towns, which is what the map editor and
   * every scene test use.
   */
  readonly seenCities?: ReadonlyMap<string, SeenCity> | undefined;
}

export interface Scene3D {
  readonly world: World;
  /** Sparks, dust, tracers and per-unit pose overrides. */
  readonly fx: CombatFx;
  /**
   * The free camera, shared verbatim with the digital twins.
   *
   * There is no toggle to find: pressing W A S D Q E R F takes the camera, and
   * it hands itself back a second after the keys come up. See `flyControls.ts`
   * for why that latch replaced a button.
   */
  readonly drone: {
    readonly engaged: boolean;
    /** Speed, altitude, height above ground, heading and throttle. */
    telemetry(): FlyTelemetry;
    /** Take or release the camera explicitly, for a button. */
    setEngaged(on: boolean): void;
    /** Swing the view round to due north without moving the camera. */
    faceNorth(): void;
    /**
     * Where the orbit camera is currently centred.
     *
     * Exposed for the hand-back check: the interesting question when the drone
     * lets go is not whether a target exists but whether it is one the orbit
     * camera will accept without snapping.
     */
    orbitTarget(): Vector3;
    /** Subscribe to the latch. Returns an unsubscribe. */
    onEngagedChange(listener: (engaged: boolean) => void): () => void;
  };
  /**
   * Scripted camera moves for the game's first-time moments.
   *
   * Owns the camera outright while a shot runs, for the same reason the drone
   * does: `OrbitControls.update()` re-applies the orbit pose on every call and
   * would drag a cinematic back towards the orbit centre one frame at a time.
   */
  readonly cinema: {
    /** Resolves when the shot ends, or immediately when one is already running. */
    play(shot: CinematicShot): Promise<void>;
    /** End the current shot now. The promise still resolves. */
    skip(): void;
    readonly active: boolean;
  };
  /** Rebuild the ground for a new map. Slow, and only called on a new game. */
  loadMap(map: GameMap): void;
  /** Reconcile units, cities and overlays against the current state. */
  sync(state: GameState, view: Scene3DView): void;
  /** Which hex is under a screen point, if any. */
  hexAt(screenX: number, screenY: number): Hex | undefined;
  /** Glide the camera to look at a hex. */
  focus(hex: Hex, immediate?: boolean): void;
  /**
   * Glide the camera to an arbitrary point, optionally closing to a given
   * distance. Used to frame a fight between two hexes rather than one.
   */
  focusWorld(point: Vector3, distance?: number): void;
  /** World position of the ground at a hex, for effects. */
  groundAt(hex: Hex): Vector3;
  /** Project a world position to screen pixels, for HTML overlays. */
  project(point: Vector3): { x: number; y: number; visible: boolean };
  setSize(width: number, height: number): void;
  setQuality(quality: WorldQuality): void;
  setGridVisible(visible: boolean): void;
  /**
   * Which hexes are corrupted: the Ungoverned Wastes, and any ground an
   * antagonist holds. Drawn as torn scanlines rather than a border tint (D56).
   */
  setCorrupted(hexes: readonly Hex[]): void;
  /**
   * Replace the fog.
   *
   * `unseen` has never been visited; `remembered` has been seen before but is
   * not currently watched. Both are hex lists rather than sets, because the
   * renderer only ever iterates them.
   */
  setFog(unseen: readonly Hex[], remembered: readonly Hex[]): void;
  /**
   * Draw one frame. The shake is applied to the camera for this frame only
   * and then undone, so it can never accumulate into the orbit state.
   */
  render(deltaSeconds: number, shake?: { x: number; y: number }): void;
  readonly stats: () => { triangles: number; draws: number };
  /**
   * Measured facts about the built ground.
   *
   * Exists because the surface came out uniformly grey once and three
   * different theories all sounded plausible. Numbers settled it in one
   * round trip; staring at screenshots would not have.
   */
  readonly probe: () => {
    vertices: number;
    meanColour: [number, number, number];
    colourSpread: number;
    flatFraction: number;
    minY: number;
    maxY: number;
    upFacing: number;
    detailNormalZ: number;
    erosionMaxDelta: number;
    trees: number;
    rocks: number;
  } | undefined;
  dispose(): void;
}

const HOVER_COLOUR = '#cfe8ff';
const MOVE_COLOUR = '#4ea8ff';
const MOVE_STOP_COLOUR = '#ffb64d';
const ATTACK_COLOUR = '#ff5a48';
const SELECT_COLOUR = '#ffd166';
/*
 * Settle proposals.
 *
 * ⚠️ Green, and deliberately not any of the four above. Blue already means
 * "you can walk here", orange "and that ends your turn", red "you can attack
 * this" and yellow "this is selected". A fifth meaning needs a fifth colour or
 * it is not a meaning.
 *
 * ⚠️ **A fifth colour was not enough, and the numbers say why.** Measured
 * against the ground immediately around it, the strongest of the five
 * proposals stood out about seven times less than the selection marker: a
 * soft mint wash laid over grass, on a tile the blue movement wash was
 * usually tinting as well. The meaning was distinct and the mark was not.
 *
 * So the proposals are no longer a wash at all. They are a ring, a rank, and
 * a beacon over the best one, and the colour is now the least of it.
 */
const SETTLE_COLOUR = '#8fd694';

/**
 * How big a rank number and the beacon are drawn, in pixels of screen.
 *
 * ⚠️ **Deliberately in SCREEN units, not world units.** Measured at the
 * camera a game opens on, five proposed hexes together covered about 24 by 11
 * pixels: roughly five pixels each. Anything painted on the ground is
 * invisible there however bright it is, because there is no room for it. A
 * sprite with `sizeAttenuation` off keeps the same size at every zoom, so the
 * advice survives the view the player actually plans in.
 */
const RANK_PIXELS = 26;
const BEACON_PIXELS = 34;

/** Digits are few and reused every rebuild, so draw each one once. */
const rankTextures = new Map<number, CanvasTexture>();

function rankTexture(rank: number): CanvasTexture {
  const existing = rankTextures.get(rank);
  if (existing) return existing;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12, 20, 14, 0.82)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = SETTLE_COLOUR;
  ctx.stroke();

  ctx.fillStyle = '#eafbec';
  ctx.font = 'bold 36px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(rank), size / 2, size / 2 + 2);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  rankTextures.set(rank, texture);
  return texture;
}

let beaconTexture: CanvasTexture | undefined;

/** A pin, drawn once: a stem and a head, pointing down at its own tile. */
function beaconSprite(): CanvasTexture {
  if (beaconTexture) return beaconTexture;

  const w = 64;
  const h = 96;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.strokeStyle = 'rgba(12, 20, 14, 0.85)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(w / 2, 26);
  ctx.lineTo(w / 2, h - 4);
  ctx.stroke();
  ctx.strokeStyle = SETTLE_COLOUR;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w / 2, 26);
  ctx.lineTo(w / 2, h - 4);
  ctx.stroke();

  // The head: a diamond, which is not a shape the terrain or any unit uses.
  ctx.beginPath();
  ctx.moveTo(w / 2, 2);
  ctx.lineTo(w / 2 + 20, 24);
  ctx.lineTo(w / 2, 46);
  ctx.lineTo(w / 2 - 20, 24);
  ctx.closePath();
  ctx.fillStyle = SETTLE_COLOUR;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(12, 20, 14, 0.85)';
  ctx.stroke();

  beaconTexture = new CanvasTexture(canvas);
  beaconTexture.colorSpace = SRGBColorSpace;
  return beaconTexture;
}

/**
 * Gold, and not the amber the raid float already uses.
 *
 * ⚠️ Warm colours are crowded on this map: the attack wash, the "RAIDED" float
 * and the corruption tint are all in the orange half. This sits higher and
 * more saturated so a cache does not read as a threat, which is the one
 * misreading that would actually cost the player something.
 */
const TREASURE_COLOUR = '#ffd166';

/**
 * Bigger than a rank digit, smaller than the settle pin.
 *
 * The pin marks one recommendation and should dominate; a cache is a fact and
 * there may be several on screen at once.
 */
const CHEST_PIXELS = 26;

let chestTexture: CanvasTexture | undefined;

/**
 * A chest, drawn once: a lid, a body, a band and a lock.
 *
 * ⚠️ Deliberately a silhouette rather than a detailed little box. At 26 screen
 * pixels, which is what `sizeAttenuation: false` pins it to at every zoom, the
 * detail would be sub-pixel mush; what survives at that size is the outline
 * and the dark keyhole, so those are the only things drawn.
 */
function chestSprite(): CanvasTexture {
  if (chestTexture) return chestTexture;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const outline = 'rgba(28, 18, 6, 0.92)';
  const left = 8;
  const right = size - 8;
  const lidTop = 16;
  const seam = 32;
  const base = size - 10;

  // Body.
  ctx.fillStyle = TREASURE_COLOUR;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.rect(left, seam, right - left, base - seam);
  ctx.fill();
  ctx.stroke();

  // Lid: a half-round, so the shape is not just a rectangle at a glance.
  ctx.beginPath();
  ctx.moveTo(left, seam);
  ctx.lineTo(left, lidTop + 6);
  ctx.quadraticCurveTo(size / 2, lidTop - 12, right, lidTop + 6);
  ctx.lineTo(right, seam);
  ctx.closePath();
  ctx.fillStyle = '#f0b445';
  ctx.fill();
  ctx.stroke();

  // The seam and the lock, which are what carry the shape when it is small.
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(left, seam);
  ctx.lineTo(right, seam);
  ctx.stroke();
  ctx.fillStyle = outline;
  ctx.fillRect(size / 2 - 5, seam - 5, 10, 14);

  chestTexture = new CanvasTexture(canvas);
  chestTexture.colorSpace = SRGBColorSpace;
  return chestTexture;
}

/**
 * Width of a city's health bar, in screen pixels.
 *
 * Wider than the chest, because this one has to be readable as a *proportion*
 * rather than recognised as a shape: the whole message is how much of the bar
 * is gone, and that judgement needs length.
 */
const HEALTH_BAR_PIXELS = 46;
const HEALTH_BAR_ASPECT = 0.16;

/**
 * How many distinct bars are drawn.
 *
 * ⚠️ Quantised so the textures can be cached. A bar drawn from the exact
 * fraction would need a new canvas every time a city took a hit, and cities
 * are re-synced on every dirty frame: that is a texture upload per frame per
 * damaged town, for a difference of well under one pixel at this width.
 * Twelve steps is finer than the eye resolves across 46 pixels.
 */
const HEALTH_BAR_STEPS = 12;

const healthBarTextures = new Map<number, CanvasTexture>();

/**
 * A health bar, drawn once per twelfth.
 *
 * ⚠️ Red-to-amber-to-green by remaining fraction, and NOT the faction colour.
 * A bar that changed hue by owner would collide with the seven antagonist
 * colours the map already uses, and the one thing this has to say at a glance
 * is "how bad is it", which is a scale, not an identity.
 */
function healthBarSprite(fraction: number): CanvasTexture {
  const step = Math.max(0, Math.min(HEALTH_BAR_STEPS, Math.round(fraction * HEALTH_BAR_STEPS)));
  const cached = healthBarTextures.get(step);
  if (cached) return cached;

  const w = 128;
  const h = Math.round(w * HEALTH_BAR_ASPECT);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const share = step / HEALTH_BAR_STEPS;
  const pad = 3;

  // The empty trough, dark enough to read against grass, snow and water.
  ctx.fillStyle = 'rgba(10, 14, 20, 0.82)';
  ctx.fillRect(0, 0, w, h);

  const colour = share > 0.6 ? '#7fd48a' : share > 0.3 ? '#ffcf7a' : '#ff6b5e';
  ctx.fillStyle = colour;
  ctx.fillRect(pad, pad, Math.max(0, (w - pad * 2) * share), h - pad * 2);

  // A hairline keeps the bar from dissolving into a bright background.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  healthBarTextures.set(step, texture);
  return texture;
}


export function createScene3D(
  canvas: HTMLCanvasElement,
  quality: WorldQuality = HIGH_QUALITY,
): Scene3D {
  const world = createWorld(canvas, quality);
  const { scene, camera } = world;

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  // Left drag pans, right drag orbits. A click is detected separately, so
  // selection and panning can share the left button without fighting.
  controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
  controls.screenSpacePanning = false;
  controls.minDistance = 6;
  /*
   * Far enough to see the whole world.
   *
   * This was 150, which framed a radius-25 map at 87 units across with room
   * to spare. The map is now 156 units across, so 150 could not pull back far
   * enough to see it: the limit silently became a cap on how much of your own
   * empire you were allowed to look at.
   */
  controls.maxDistance = 320;
  // Stop just short of the horizon. Going below it shows the underside of
  // the world, and there is nothing there.
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minPolarAngle = Math.PI * 0.06;

  const terrainGroup = new Group();
  const entityGroup = new Group();
  const overlayGroup = new Group();
  const fx = createCombatFx();
  scene.add(terrainGroup, entityGroup, overlayGroup, fx.group);

  const corruption = createCorruption((mesh) => {
    for (const child of [...overlayGroup.children]) {
      if (child.userData.corruption === true) overlayGroup.remove(child);
    }
    if (mesh) {
      mesh.userData.corruption = true;
      overlayGroup.add(mesh);
    }
  });

  /*
   * Fog lives in its own group, not in `overlayGroup`.
   *
   * ⚠️ The overlay group is cleared and rebuilt on every sync, which is right
   * for reachable-tile highlights and wrong for fog: rebuilding six thousand
   * merged patches every time a unit is selected would be the most expensive
   * thing in the frame, for a layer that only changes when ground is uncovered.
   */
  const fogGroup = new Group();
  fogGroup.name = 'fog';
  scene.add(fogGroup);

  const fog = createFog((added, removed) => {
    for (const mesh of removed) fogGroup.remove(mesh);
    for (const mesh of added) fogGroup.add(mesh);
  });

  let terrain: Terrain | undefined;
  let scatter: Scatter | undefined;
  let water: WaterSurface | undefined;
  let groundMesh: Mesh | undefined;
  let mapRadius = 0;

  // Drone camera --------------------------------------------------------
  /*
   * The free camera, ported unchanged from the digital twins. Every number it
   * takes is an option precisely so a host at a different scale does not have
   * to edit the module, and this host is at a *very* different scale: the
   * twins fly over tens of kilometres, this world is about 86 units across
   * with a couple of units of relief. Left on its defaults the drone would
   * cross the entire empire in a fifth of a second and hand the camera back
   * 1200 units away, which is eight times the orbit limit.
   *
   * So the units below are hexes, not metres. One hex radius is 1.
   */
  const droneListeners = new Set<(engaged: boolean) => void>();

  /**
   * Ground height for the drone, or null past the edge of the map.
   *
   * Returning null rather than sea level matters: the altimeter then reads
   * "off the map" instead of confidently reporting a height above water that
   * does not exist, and the speed scaling stops pretending it knows how close
   * the ground is.
   */
  function droneGroundAt(x: number, z: number): number | null {
    if (!terrain) return null;
    const reach = (mapRadius + 1) * HEX_RADIUS * 1.9;
    if (Math.hypot(x, z) > reach) return null;
    return terrain.surfaceAt(x, z);
  }

  const fly = createFlyControls({
    camera,
    domElement: canvas,
    controls,
    groundAt: droneGroundAt,
    // Crossing the map takes about eight seconds at the default setting, and
    // the slowest step is a walking pace along a ridge line.
    cruiseMinMs: 1.5,
    cruiseMaxMs: 45,
    cruiseDefaultMs: 9,
    boost: 3,
    // The orbit camera is bounded at 150, so the old 1200 would have been
    // clamped on the first frame after the hand-back: a visible jump.
    handoffDistanceM: 28,
    // Roughly the height a city looks right from. Below it the camera slows
    // down, which is what makes flying between trees feel controllable
    // without anyone touching the throttle.
    referenceAglM: 5,
    // Mass and a gimbal. Both are what separates a camera that flies from one
    // that teleports, and this scene is the one place in the game where the
    // player is meant to just look at the thing.
    accelerateTauS: 0.45,
    brakeTauS: 0.22,
    lookTauS: 0.07,
    onEngagedChange: (engaged) => {
      // A scripted flight and the player cannot both own the camera. The
      // player wins; a duel that framed itself mid-takeoff simply stops.
      if (engaged) {
        flightFrom = undefined;
        flightTo = undefined;
        flightDistance = undefined;
      }
      for (const listener of droneListeners) listener(engaged);
    },
  });

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const shakeRight = new Vector3();
  const shakeUp = new Vector3();
  const shakeForward = new Vector3();

  const unitObjects = new Map<string, Group>();
  const cityObjects = new Map<string, Group>();
  const ruinObjects = new Map<string, Group>();
  /**
   * Ghosts of remembered towns, keyed by hex rather than by city id.
   *
   * The player remembers a *place*: a razed town and whatever is built on the
   * same ground later are one memory, and a city id would make them two.
   */
  const ghostObjects = new Map<string, Group>();

  /**
   * Make a built town look like a memory rather than a sighting.
   *
   * ⚠️ **Every material is CLONED first, and that is not a style choice.**
   * `entities.ts` caches its materials by name and shares one instance across
   * every building in the game, so dimming them in place would fade every
   * town on the map, including the one the player is standing in.
   *
   * Desaturated as well as faded: opacity alone still reads as a town seen
   * through haze, whereas draining the colour reads as a recollection. The
   * faction band keeps enough hue to say whose it was, which is half the
   * question the player asked.
   */
  function ghostify(root: Object3D): void {
    root.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      const source = mesh.material;
      mesh.material = Array.isArray(source) ? source.map(dimmed) : dimmed(source);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
  }

  function dimmed(source: Material): Material {
    const copy = source.clone();
    copy.transparent = true;
    copy.opacity = 0.42;
    /*
     * ⚠️ `depthWrite: false` so the ghost's own faces do not occlude each
     * other once transparent, which otherwise shows as holes in the roofs
     * where the far side of a wall paints over the near side.
     */
    copy.depthWrite = false;
    const tinted = copy as Material & { color?: Color };
    if (tinted.color) {
      const grey = tinted.color.clone();
      // Pull most of the way to the luminance of the same colour.
      const luma = grey.r * 0.2126 + grey.g * 0.7152 + grey.b * 0.0722;
      grey.setRGB(
        grey.r * 0.25 + luma * 0.75,
        grey.g * 0.25 + luma * 0.75,
        grey.b * 0.25 + luma * 0.75,
      );
      tinted.color = grey.multiplyScalar(0.75);
    }
    return copy;
  }

  /**
   * Remove a ghost and free the materials cloned for it.
   *
   * ⚠️ Cloned materials are NOT shared, so nothing else will ever dispose
   * them. Dropping the object without this leaks one material per mesh per
   * rebuild, and a ghost is rebuilt every time the remembered town changes.
   */
  function disposeGhost(root: Group): void {
    root.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    });
    entityGroup.remove(root);
  }

  const overlayObjects: Object3D[] = [];

  // Camera flight -------------------------------------------------------
  let flightFrom: Vector3 | undefined;
  let flightTo: Vector3 | undefined;
  let flightStart = 0;
  let flightDistance: number | undefined;
  let flightFromDistance = 0;
  const FLIGHT_MS = 520;

  // Cinematics ----------------------------------------------------------
  /*
   * A shot owns the camera outright while it runs.
   *
   * ⚠️ It also has to put the orbit camera back on the way out. Leaving the
   * player wherever the last frame ended would strand the map camera at a
   * cinematic angle, frequently below the terrain, and `OrbitControls` would
   * then snap it on the very next update. So the pose from before the shot is
   * saved and restored, which is the same hand-back problem the drone had.
   */
  let shot: CinematicShot | undefined;
  let shotStart = 0;
  let shotResolve: (() => void) | undefined;
  const shotReturnPosition = new Vector3();
  const shotReturnTarget = new Vector3();

  function endShot(): void {
    if (!shot) return;
    shot = undefined;
    // Back to the playing grade. Walked, not cut: see `grade.ts`.
    world.setCinematic(false);
    camera.position.copy(shotReturnPosition);
    controls.target.copy(shotReturnTarget);
    controls.enabled = true;
    controls.update();
    const resolve = shotResolve;
    shotResolve = undefined;
    resolve?.();
  }

  function clearOverlays(): void {
    for (const object of overlayObjects) {
      overlayGroup.remove(object);
      if (object instanceof Mesh) object.geometry.dispose();
      /*
       * ⚠️ The sprite's MATERIAL is per-instance and must go; its TEXTURE is
       * shared and cached by rank, and disposing that would destroy the digit
       * for every later rebuild. Overlays are rebuilt on every selection, so
       * this runs constantly.
       */
      if (object instanceof Sprite) object.material.dispose();
    }
    overlayObjects.length = 0;
  }

  function addPatch(hex: Hex, colour: string, opacity: number, lift: number): void {
    if (!terrain) return;
    const geometry = hexPatch(hex, terrain, lift);
    const mesh = new Mesh(geometry, overlayMaterial(colour, opacity));
    mesh.renderOrder = 3;
    overlayGroup.add(mesh);
    overlayObjects.push(mesh);
  }

  /** The border of a hex rather than its face, for marks that must not cover. */
  function addRing(hex: Hex, colour: string, opacity: number, lift: number): void {
    if (!terrain) return;
    const geometry = hexRing(hex, terrain, lift);
    const mesh = new Mesh(geometry, overlayMaterial(colour, opacity));
    // Above the patches: a ring sits on ground that is usually also tinted.
    mesh.renderOrder = 5;
    overlayGroup.add(mesh);
    overlayObjects.push(mesh);
  }

  /**
   * A billboard that keeps its size in pixels, however far away the hex is.
   *
   * ⚠️ `sizeAttenuation: false` is the entire point. Everything else drawn on
   * the map shrinks with the camera, which is right for terrain and wrong for
   * advice: measured, five proposed hexes at the opening camera covered about
   * 24 by 11 pixels between them. `scale` is then in a normalised screen unit,
   * so the pixel sizes above are divided by the canvas height to get there.
   */
  function addSprite(
    hex: Hex,
    map: CanvasTexture,
    pixels: number,
    lift: number,
    aspect = 1,
  ): void {
    if (!terrain) return;
    const material = new SpriteMaterial({
      map,
      transparent: true,
      depthWrite: false,
      // ⚠️ Not depth-tested. A pin standing on a hillside is otherwise buried
      // by the hill in front of it, which is exactly when it is most needed.
      depthTest: false,
      sizeAttenuation: false,
    });
    const sprite = new Sprite(material);
    const { x, z } = hexToWorld(hex);
    sprite.position.set(x, terrain.heightAt(hex) + lift, z);
    const unit = pixels / Math.max(1, canvas.clientHeight);
    sprite.scale.set(unit, unit * aspect, 1);
    // The pin hangs above its tile, so its anchor is at the bottom of the art.
    sprite.center.set(0.5, aspect > 1 ? 0 : 0.5);
    sprite.renderOrder = 6;
    overlayGroup.add(sprite);
    overlayObjects.push(sprite);
  }

  function placeOnGround(object: Object3D, hex: Hex): void {
    if (!terrain) return;
    const { x, z } = hexToWorld(hex);
    object.position.set(x, terrain.heightAt(hex), z);
  }

  return {
    world,
    fx,

    drone: {
      get engaged() {
        return fly.engaged;
      },
      telemetry: () => fly.telemetry(),
      setEngaged: (on) => fly.setEngaged(on),
      faceNorth: () => fly.faceNorth(),
      orbitTarget: () => controls.target.clone(),
      onEngagedChange(listener) {
        droneListeners.add(listener);
        return () => droneListeners.delete(listener);
      },
    },

    cinema: {
      play(next) {
        // One shot at a time. A second trigger during a cinematic resolves at
        // once rather than queueing, because the moment it was announcing has
        // already passed by the time the first one ends.
        if (shot) return Promise.resolve();
        shot = next;
        shotStart = performance.now();
        // Deeper vignette and a little more contrast for the length of the
        // shot. The measured reason is in `grade.ts`: a photograph of a
        // landscape carries less local contrast than this renderer does, and
        // a film is the one place legibility is not the first priority.
        world.setCinematic(true);
        shotReturnPosition.copy(camera.position);
        shotReturnTarget.copy(controls.target);
        // Hand the drone back first, so it cannot fight the shot for the camera.
        fly.setEngaged(false);
        controls.enabled = false;
        flightFrom = undefined;
        flightTo = undefined;
        flightDistance = undefined;
        return new Promise<void>((resolve) => {
          shotResolve = resolve;
        });
      },
      skip: endShot,
      get active() {
        return shot !== undefined;
      },
    },

    loadMap(map) {
      if (terrain) {
        terrainGroup.remove(terrain.group);
        terrain.dispose();
      }
      if (scatter) {
        terrainGroup.remove(scatter.group);
        scatter.dispose();
      }
      if (water) {
        scene.remove(water.mesh);
        water.dispose();
      }

      terrain = buildTerrain(map);
      terrainGroup.add(terrain.group);
      groundMesh = terrain.group.children.find((c): c is Mesh => c instanceof Mesh);
      mapRadius = map.radius;

      scatter = buildScatter(map, terrain);
      terrainGroup.add(scatter.group);

      /*
       * ⚠️ The fog sheet is built HERE, with the map, and never again.
       *
       * It covers every tile, including the ones currently in sight, because a
       * clear tile becomes remembered the moment the unit watching it walks
       * away. Finding that out later would mean rebuilding later, and a
       * rebuild measured 44.8 ms at full map size, which is the whole reason
       * the fog could not keep up with a unit walking.
       */
      fog.setMap(
        [...map.tiles.values()].map((tile) => tile.hex),
        terrain,
      );

      // The sea extends well past the land so the horizon is water rather
      // than an abrupt edge where the map stops.
      const extent = map.radius * HEX_RADIUS * 4;
      water = createWater(extent * 2.6, SEA_LEVEL, quality.shadowMapSize >= 2048 ? 512 : 256);
      water.setSunDirection(world.sun.position.clone().normalize());
      scene.add(water.mesh);

      const half = map.radius * HEX_RADIUS * 1.9;
      world.fitShadows(new Vector3(0, 0, 0), half);

      // Open on a low, wide establishing view of the whole landmass.
      controls.target.set(0, 0, 0);
      camera.position.set(0, half * 0.72, half * 0.95);
      controls.update();
    },

    sync(state, view) {
      if (!terrain) return;

      /*
       * What the player can see right now.
       *
       * ⚠️ Own units and cities are ALWAYS drawn, whatever the fog says. They
       * are what generates sight in the first place, so hiding one would be a
       * self-inflicted blindness the player could do nothing about, and a
       * rounding error in the sight radius would make a unit vanish.
       */
      const canSee = (hex: Hex, factionId: string): boolean => {
        if (!view.visibleHexes) return true;
        if (factionId === PLAYER_FACTION_ID) return true;
        return view.visibleHexes.has(hexKey(hex));
      };

      // Units ------------------------------------------------------------
      const liveUnits = new Set<string>();
      for (const unit of state.units.values()) {
        if (!canSee(unit.hex, unit.factionId)) continue;
        liveUnits.add(unit.id);
        let object = unitObjects.get(unit.id);
        if (!object) {
          const colour = state.factions.get(unit.factionId)?.colour ?? '#888888';
          object = buildUnit(unit, colour);
          entityGroup.add(object);
          unitObjects.set(unit.id, object);
        }
        placeOnGround(object, unit.hex);

        // Animation is a display offset applied after placement, so the
        // engine position stays the single source of truth and a dropped
        // frame can never leave a unit stranded off its hex.
        const offset = view.unitOffset?.(unit.id);
        if (offset) {
          object.position.x += offset.x;
          object.position.z += offset.z;
        }

        // Remembered before any pose is applied, so a wreck can keep being
        // animated after the engine has stopped reporting the unit at all.
        (object.userData as { basePosition?: Vector3 }).basePosition =
          object.position.clone();

        // A combat pose sits on top of that: where the unit has been thrown,
        // which way it is facing, and how far it has toppled over.
        const pose = fx.poseOf(unit.id);
        const spent = unit.factionId === state.activeFactionId && unit.movesLeft <= 0;

        if (pose) {
          object.position.add(pose.offset);
          object.position.y -= pose.sink;
          object.rotation.set(pose.pitch, pose.yaw ?? object.rotation.y, pose.roll);
        } else {
          // Spent units settle; ready units stand up. Cheaper to read than a
          // badge and it survives at any zoom.
          object.rotation.set(spent ? 0.09 : 0, object.rotation.y, 0);
        }

        const opacity = (view.unitOpacity?.(unit.id) ?? 1) * (pose?.opacity ?? 1);
        object.visible = opacity > 0.02;
        if (opacity < 1) object.scale.setScalar(Math.max(0.05, opacity));
        else object.scale.setScalar(1);

        const type = unitType(unit.typeId);
        const hurt = 1 - unit.hp / type.maxHp;
        object.position.y -= hurt * 0.04;
      }
      for (const [id, object] of unitObjects) {
        if (liveUnits.has(id)) continue;

        /**
         * A wreck outlives its unit.
         *
         * The engine removes a destroyed unit the instant the blow lands,
         * which is correct for the rules and useless for the animation: the
         * object was being deleted on the same frame the death sequence
         * started, so the topple never played and units simply blinked out.
         * While a pose exists the object is kept and driven from it; the
         * duel decides when the wreck is finally gone.
         */
        const pose = fx.poseOf(id);
        if (pose) {
          const base = (object.userData as { basePosition?: Vector3 }).basePosition;
          if (base) {
            object.position.copy(base).add(pose.offset);
            object.position.y -= pose.sink;
          }
          object.rotation.set(pose.pitch, pose.yaw ?? object.rotation.y, pose.roll);
          object.visible = pose.opacity > 0.02;
          object.scale.setScalar(Math.max(0.05, pose.opacity));
          continue;
        }

        entityGroup.remove(object);
        unitObjects.delete(id);
      }

      // Cities -----------------------------------------------------------
      const liveCities = new Set<string>();
      for (const city of state.cities.values()) {
        /*
         * ⚠️ A remembered village is NOT drawn.
         *
         * Tempting to keep it on screen once seen, and wrong: the player would
         * have a permanent live readout of a place they walked past once,
         * including whether it still stands after somebody else took it.
         * Remembered ground shows terrain, never occupants.
         */
        if (!canSee(city.hex, city.factionId)) continue;
        liveCities.add(city.id);

        const existing = cityObjects.get(city.id);
        const colour = state.factions.get(city.factionId)?.colour ?? '#888888';
        // Population, rank and ownership all change the model, so those three
        // are the rebuild triggers rather than rebuilding blindly every turn.
        // ⚠️ Rank belongs here: a promotion adds a keep and a cathedral, and
        // without it in the signature the town keeps its old shape until it
        // happens to grow a citizen or change hands.
        //
        // ⚠️ **So do the walls, for exactly the same reason.** Fortification is
        // what a player spends production on and what a siege knocks down, and
        // neither was in this string: a wall could go up, be battered and be
        // mended without the model ever being rebuilt. `isBreached` rather than
        // raw hit points, because the model only changes at that threshold and
        // keying on every point of damage would rebuild the town on every blow.
        const signature =
          `${city.population}:${city.rank}:${city.factionId}` +
          `:${city.wallLevel}:${isBreached(city) ? 'breached' : 'whole'}`;
        if (existing && existing.userData.signature === signature) {
          placeOnGround(existing, city.hex);
          continue;
        }
        if (existing) entityGroup.remove(existing);
        const object = buildCity(city, colour);
        object.userData.signature = signature;
        entityGroup.add(object);
        cityObjects.set(city.id, object);
        placeOnGround(object, city.hex);
      }
      for (const [id, object] of cityObjects) {
        if (liveCities.has(id)) continue;
        entityGroup.remove(object);
        cityObjects.delete(id);
      }

      /*
       * Remembered towns -------------------------------------------------
       *
       * A town you have found stays on the map after the fog closes, drawn
       * from the snapshot taken when you last saw it rather than from the
       * live city.
       *
       * ⚠️ **This is not a reversal of the rule above it, it is the answer to
       * the objection that rule was making.** Drawing the LIVE city here would
       * hand the player a permanent readout of a place they walked past once,
       * including whether it still stands after somebody else took it. Drawing
       * the memory shows only what they were shown, and it goes stale: a town
       * that changes hands while they are away keeps its old banner until they
       * go back and look.
       *
       * ⚠️ Skipped entirely when the real town is in sight, or the ghost and
       * the town would occupy the same ground and z-fight.
       */
      const liveGhosts = new Set<string>();
      for (const [key, seen] of view.seenCities ?? []) {
        if (canSee(seen.hex, seen.factionId)) continue;
        liveGhosts.add(key);

        const signature =
          `${seen.factionId}:${seen.kind}:${seen.rank}` +
          `:${seen.population}:${seen.wallLevel}:${seen.breached ? 'breached' : 'whole'}`;
        const existing = ghostObjects.get(key);
        if (existing && existing.userData.signature === signature) {
          placeOnGround(existing, seen.hex);
          continue;
        }
        if (existing) disposeGhost(existing);

        const colour = state.factions.get(seen.factionId)?.colour ?? '#888888';
        /*
         * `buildCity` wants a City, and a memory is deliberately not one: it
         * carries no hp and no wallHp, because those are live combat state.
         * The model only reads kind, hex, rank, population and wallLevel, so
         * the missing halves are filled with values that cannot be observed
         * in the silhouette.
         */
        const object = buildCity(
          {
            id: `seen-${key}`,
            factionId: seen.factionId,
            hex: seen.hex,
            name: seen.name,
            kind: seen.kind,
            rank: seen.rank,
            population: seen.population,
            wallLevel: seen.wallLevel,
            wallHp: seen.breached ? 0 : 1,
            hp: 1,
          } as unknown as Parameters<typeof buildCity>[0],
          colour,
        );
        ghostify(object);
        object.userData.signature = signature;
        entityGroup.add(object);
        ghostObjects.set(key, object);
        placeOnGround(object, seen.hex);
      }
      for (const [key, object] of ghostObjects) {
        if (liveGhosts.has(key)) continue;
        disposeGhost(object);
        ghostObjects.delete(key);
      }

      // Ruins ------------------------------------------------------------
      // Never rebuilt: a ruin does not change once it exists, so the only
      // work here is adding the ones that are new since the last sync.
      for (const ruin of state.ruins.values()) {
        if (ruinObjects.has(ruin.id)) continue;
        const object = buildRuin(ruin);
        entityGroup.add(object);
        ruinObjects.set(ruin.id, object);
        placeOnGround(object, ruin.hex);
      }

      // Overlays ---------------------------------------------------------
      clearOverlays();

      if (view.reachable) {
        for (const entry of view.reachable.values()) {
          if (entry.cost === 0) continue;
          addPatch(
            entry.hex,
            entry.stops ? MOVE_STOP_COLOUR : MOVE_COLOUR,
            entry.stops ? 0.15 : 0.1,
            0.035,
          );
        }
      }
      if (view.attackTargets) {
        for (const key of view.attackTargets) {
          const tile = state.map.tiles.get(key);
          if (tile) addPatch(tile.hex, ATTACK_COLOUR, 0.22, 0.045);
        }
      }
      /*
       * Settle proposals: a ring, a rank, and a pin over the best one.
       *
       * ⚠️ Drawn above the movement patches, because a proposed site is
       * usually also somewhere you can walk, and the two washes used to blend
       * additively into a colour that was neither.
       */
      if (view.settleSites) {
        view.settleSites.forEach((hex, index) => {
          addRing(hex, SETTLE_COLOUR, index === 0 ? 0.62 : 0.34, 0.05);
          addSprite(hex, rankTexture(index + 1), RANK_PIXELS, 0.55);
          if (index === 0) addSprite(hex, beaconSprite(), BEACON_PIXELS, 1.9, 1.5);
        });
      }
      /*
       * Buried caches: a warm ring and a chest.
       *
       * ⚠️ Drawn after the settle rings on purpose. The two can land on the
       * same hex (a cache does not care that the site is good farmland), and
       * the gold has to win: a settle ring is advice the player can ignore,
       * a cache is a thing that is actually there.
       */
      if (view.treasures) {
        for (const hex of view.treasures) {
          addRing(hex, TREASURE_COLOUR, 0.5, 0.052);
          addSprite(hex, chestSprite(), CHEST_PIXELS, 0.9);
        }
      }
      /*
       * A health bar over any town that has been hurt.
       *
       * ⚠️ **Only when damaged, and that is the whole design.** Seven
       * antagonist capitals plus the player's own, each wearing a full green
       * bar for the entire game, is furniture: it would be on screen
       * constantly and mean nothing, so the one time it matters would be the
       * one time nobody looks. A bar that appears only when something is
       * wrong is an event rather than a decoration.
       *
       * ⚠️ **Gated on `canSee`, exactly as the city model above is.** Overlay
       * sprites are drawn with `depthTest: false` so they are never buried by
       * a hill, which also means they punch straight through fog. Without
       * this line a bar would hover over a town the player cannot see, giving
       * them a live readout of a siege happening somewhere dark, and would
       * appear over remembered ground where the town itself is deliberately
       * not drawn. The first version of this loop had exactly that bug.
       *
       * Enemy towns you CAN see are included on purpose: that a hostile
       * capital is at half strength is what turns a raid into a plan.
       */
      for (const city of state.cities.values()) {
        if (!canSee(city.hex, city.factionId)) continue;
        const full = maxCityHp(city);
        if (city.hp >= full) continue;
        addSprite(
          city.hex,
          healthBarSprite(city.hp / full),
          HEALTH_BAR_PIXELS,
          1.35,
          HEALTH_BAR_ASPECT,
        );
      }
      if (view.hover && state.map.tiles.has(hexKey(view.hover))) {
        addPatch(view.hover, HOVER_COLOUR, 0.1, 0.05);
      }
      if (view.selectedUnitId) {
        const unit = state.units.get(view.selectedUnitId);
        if (unit) addPatch(unit.hex, SELECT_COLOUR, 0.24, 0.055);
      }
    },

    hexAt(screenX, screenY) {
      if (!groundMesh) return undefined;
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((screenX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((screenY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(groundMesh, false);
      const hit = hits[0];
      if (!hit) return undefined;
      const { q, r } = worldToAxial(hit.point.x, hit.point.z);
      return hexRound(q, r);
    },

    focus(hex, immediate = false) {
      const { x, z } = hexToWorld(hex);
      const target = new Vector3(x, terrain?.heightAt(hex) ?? 0, z);
      if (immediate) {
        const delta = target.clone().sub(controls.target);
        controls.target.copy(target);
        camera.position.add(delta);
        controls.update();
        return;
      }
      flightFrom = controls.target.clone();
      flightTo = target;
      flightStart = performance.now();
      flightDistance = undefined;
    },

    focusWorld(point, distance) {
      flightFrom = controls.target.clone();
      flightTo = point.clone();
      flightStart = performance.now();
      flightDistance = distance;
      flightFromDistance = camera.position.distanceTo(controls.target);
    },

    groundAt(hex) {
      const { x, z } = hexToWorld(hex);
      return new Vector3(x, terrain?.heightAt(hex) ?? 0, z);
    },

    project(point) {
      const projected = point.clone().project(camera);
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((projected.x + 1) / 2) * rect.width,
        y: ((1 - projected.y) / 2) * rect.height,
        visible: projected.z < 1,
      };
    },

    setSize(width, height) {
      world.setSize(width, height);
    },

    setQuality(next) {
      world.setQuality(next);
    },

    setGridVisible(visible) {
      terrain?.setGridVisible(visible);
    },

    setCorrupted(hexes) {
      if (terrain) corruption.set(hexes, terrain);
    },

    setFog(unseen, remembered) {
      fog.set(unseen, remembered);
      /*
       * ⚠️ Props have to be hidden too, not just covered.
       *
       * The fog lid clears the tallest terrain vertex in its hex by a tenth
       * of a unit, which covers the ground and does not come close to
       * covering a two-unit tree. Measured: every one of 6,150 lids sat above
       * its terrain and the map still looked unfogged, because the forest was
       * standing straight through it.
       */
      scatter?.setHidden(new Set(unseen.map((h) => hexKey(h))));
    },

    render(delta, shake) {
      /*
       * Exactly one thing may drive the camera per frame. While the drone is
       * latched, `controls.update()` must not run: it re-applies the orbit
       * pose every call whether anything moved or not, so leaving it in would
       * silently drag the camera back towards the orbit centre and the drone
       * would feel like it was flying through treacle.
       */
      if (shot) {
        // A shot outranks everything: no orbit, no drone, no scripted flight.
        const elapsed = performance.now() - shotStart;
        const frame = shot.frame(Math.min(1, elapsed / shot.durationMs));
        camera.position.copy(frame.position);
        camera.lookAt(frame.target);
        if (elapsed >= shot.durationMs) endShot();
      } else if (fly.engaged) {
        fly.update(delta);
      } else {
        if (flightFrom && flightTo) {
          const t = Math.min(1, (performance.now() - flightStart) / FLIGHT_MS);
          const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          const next = flightFrom.clone().lerp(flightTo, eased);
          const move = next.clone().sub(controls.target);
          controls.target.copy(next);
          camera.position.add(move);

          // Dolly along the existing view direction rather than teleporting,
          // so the approach keeps whatever angle the player had chosen.
          if (flightDistance !== undefined) {
            const wanted = flightFromDistance + (flightDistance - flightFromDistance) * eased;
            const direction = camera.position.clone().sub(controls.target).normalize();
            camera.position.copy(controls.target).addScaledVector(direction, wanted);
          }

          if (t >= 1) {
            flightFrom = undefined;
            flightTo = undefined;
            flightDistance = undefined;
          }
        }

        controls.update();
      }

      water?.update(delta * 0.35);
      fx.update(delta);
      corruption.update(delta);
      // Fog that does not move is a painted backdrop. The drift is slow enough
      // that it reads as weather rather than as an animation.
      fog.update(delta);

      // Keep the shadow frustum around the camera target rather than the
      // whole map: a frustum big enough for a radius-25 map wastes most of
      // its resolution on ground nobody is looking at.
      const focusRadius = Math.min(mapRadius * HEX_RADIUS * 1.9, 46);
      world.fitShadows(controls.target, focusRadius);

      if (shake && (shake.x !== 0 || shake.y !== 0)) {
        // Shake along the camera's own right and up axes, scaled by distance
        // so the kick looks the same size whether zoomed in or out.
        const distance = camera.position.distanceTo(controls.target);
        const amount = (distance / 600) * 1;
        camera.matrixWorld.extractBasis(shakeRight, shakeUp, shakeForward);
        const offset = shakeRight
          .multiplyScalar(shake.x * amount)
          .add(shakeUp.multiplyScalar(shake.y * amount));
        camera.position.add(offset);
        world.render();
        camera.position.sub(offset);
        return;
      }

      world.render();
    },

    stats: () => ({
      triangles: world.renderer.info.render.triangles,
      draws: world.renderer.info.render.calls,
    }),

    probe: () => {
      if (!groundMesh) return undefined;
      const geometry = groundMesh.geometry;
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      const colour = geometry.getAttribute('color');
      if (!position || !normal || !colour) return undefined;

      let r = 0;
      let g = 0;
      let b = 0;
      let flat = 0;
      let up = 0;
      let minY = Infinity;
      let maxY = -Infinity;
      const sample = Math.max(1, Math.floor(position.count / 20000));
      let counted = 0;

      for (let i = 0; i < position.count; i += sample) {
        r += colour.getX(i);
        g += colour.getY(i);
        b += colour.getZ(i);
        const ny = normal.getY(i);
        if (ny > 0.97) flat += 1;
        if (ny > 0) up += 1;
        const y = position.getY(i);
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        counted += 1;
      }

      // Spread is the mean absolute deviation of the channels from the mean
      // grey: near zero means every vertex is the same colour, which is the
      // symptom the probe was written to catch.
      const mr = r / counted;
      const mg = g / counted;
      const mb = b / counted;
      const mean = (mr + mg + mb) / 3;
      const spread = (Math.abs(mr - mean) + Math.abs(mg - mean) + Math.abs(mb - mean)) / 3;

      return {
        vertices: position.count,
        meanColour: [mr, mg, mb],
        colourSpread: spread,
        flatFraction: flat / counted,
        minY,
        maxY,
        upFacing: up / counted,
        detailNormalZ: terrain?.detailNormalZ ?? 0,
        erosionMaxDelta: terrain?.erosionMaxDelta ?? 0,
        trees: scatter?.counts.trees ?? 0,
        rocks: scatter?.counts.rocks ?? 0,
      };
    },

    dispose() {
      endShot();
      corruption.dispose();
      fog.dispose();
      fly.dispose();
      controls.dispose();
      clearOverlays();
      fx.dispose();
      terrain?.dispose();
      scatter?.dispose();
      water?.dispose();
      disposeEntityMaterials();
      world.dispose();
    },
  };
}
