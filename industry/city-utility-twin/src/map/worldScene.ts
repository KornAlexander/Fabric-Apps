import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SITES, WORLD_SHELL_SITE, siteById, type SiteConfig } from '../config/world';
import { ASSET_BINDING } from '../config/terrainBase';
import { createAssetReader } from '../assets/reader.mjs';
import { wgs84ToUtm32 } from '../geo/utm32.mjs';
import { loadCore, loadShell, type ProgressReporter, type TerrainAssets } from './terrainLoader';
import { createTerrainMaterial, SUN_DIRECTION, SUN_TINT, SHADOW_TINT } from './terrainMaterial';
import { createShellMaterial, type ShellCore } from './shellMaterial';
import { loadBuildings } from './buildings';
import { loadVegetation } from './vegetation';
import { createSky } from './sky';
import { createFlyControls, type FlyTelemetry } from './flyControls';
import { headingFromAzimuth } from './compass';

/**
 * Where a live layer may put things, and how it converts a real-world position into one.
 *
 * ⚠️ THE ONLY SANCTIONED ROUTE FROM lat/lon INTO THE SCENE. Every live source in this app speaks
 * WGS84 and every asset is EPSG:25832 on a world origin that is an accident of where the first
 * core's grid happened to snap. A layer that does its own arithmetic will be plausibly wrong, so
 * layers are handed this instead of the numbers they would need to do it themselves.
 */
export interface WorldPlacement {
  /** Scene node live layers add to. Cleared when the map is disposed. */
  readonly group: THREE.Group;
  /**
   * World position for a geographic coordinate.
   *
   * @param altitudeM Metres above sea level (the same datum the terrain uses, DHHN2016). When
   *   omitted the position is placed on the ground.
   */
  toWorld(latDeg: number, lonDeg: number, altitudeM?: number): THREE.Vector3;
  /**
   * World position for a coordinate that is ALREADY in EPSG:25832.
   *
   * ⚠️ Not a convenience wrapper. The Landeshauptstadt publishes its open data in EPSG:25832,
   * the same grid the terrain was built in, so projecting it to WGS84 and back would add two
   * conversions and their rounding to data that was already in the right system.
   */
  toWorldUtm(easting: number, northing: number, altitudeM?: number): THREE.Vector3;
  /** Bounding box of a core in EPSG:25832, for asking a source only for what can be drawn. */
  coreBboxUtm(siteId: string): { minE: number; minN: number; maxE: number; maxN: number } | null;
  /**
   * The modelled world, as a scene-space rectangle [minX, minZ, maxX, maxZ].
   *
   * ⚠️ Layers MUST clip to this. A live feed is queried by radius and does not know where the
   * terrain stops: an aircraft 60 km away is a real aircraft, and drawing it would hang it in
   * empty space beyond the edge of the shell, which reads as a rendering fault rather than as
   * the truthful statement "that one is off the map".
   */
  readonly worldBoundsM: readonly [number, number, number, number];
  /** Terrain elevation in metres at a world position, or null where nothing is modelled. */
  groundAt(x: number, z: number): number | null;
  /** Re-render soon. Layers that mutate geometry outside the frame loop should call this. */
  invalidate(): void;
}

export interface LiveLayer {
  readonly id: string;
  setVisible(visible: boolean): void;
  /** Called once per frame with the seconds since the last frame. */
  update?(dtSeconds: number, camera: THREE.PerspectiveCamera): void;
  /**
   * Called when the user clicks this layer's geometry, or with null when the selection is
   * cleared. Lets a layer highlight what was picked.
   */
  onPicked?(detail: PickDetail | null): void;
  dispose(): void;
}

/**
 * What a layer says about the thing the user clicked.
 *
 * ⚠️ FIELDS ARE SOURCE VALUES, NOT PROSE. The `fields` are rendered as a label/value list
 * verbatim, so a layer must not summarise, translate or round anything on the way in. The point
 * of clicking a construction site is to read what the city actually published about it.
 */
export interface PickDetail {
  /** Which layer it came from, so the panel can label the source. */
  layerId: string;
  title: string;
  subtitle?: string;
  /** Accent colour for the panel's leading edge, matching the object on the map. */
  accent?: number;
  fields: { label: string; value: string }[];
  /** Attribution line for the panel footer. */
  source: string;
  /**
   * Identifiers a coordination note needs, when the picked object is a construction site.
   *
   * ⚠️ THE NOTE KEEPS ITS OWN COPY OF THE POSITION, and that is deliberate rather than
   * redundant. `baustelleId` is a GeoServer feature id tied to the row's place in the published
   * layer, so a republish can hand it to a different Baustelle. Storing the coordinates with the
   * note means it still sits in the right street when that happens.
   */
  baustelleId?: string;
  /** Which MVG stop was picked, so the layer can fetch its departures on demand. */
  haltestelleId?: string;
  easting?: number;
  northing?: number;
}

export interface WorldMap {
  reset(): void;
  faceNorth(): void;
  /** Fly the camera to another core. Returns when the flight has been started, not finished. */
  flyToSite(id: string): void;
  /**
   * Fly the camera so that every given world position is inside the frame.
   *
   * ⚠️ EXISTS BECAUSE A LAYER CAN BE SWITCHED ON AND SHOW NOTHING. Measured: turning on the
   * official air-quality layer at the default München view drew five columns, all of them
   * outside the frame, while the panel said "5 Messstationen". A layer whose status line and
   * viewport disagree reads as broken, and the user cannot tell whether the data failed or the
   * camera is simply pointed elsewhere.
   *
   * The current view DIRECTION is preserved and only the distance and target change, so the
   * user's heading is not silently reset underneath them.
   *
   * @param nearTargetM When given, and when at least one point lies within this distance of the
   *   current view target, ONLY those points are framed. This stops a single distant outlier
   *   from forcing a regional zoom: framing all five air-quality stations needs 16.6 km of
   *   altitude because two of them are 13 km out, which throws away the city the user was
   *   looking at to show two columns they did not ask about.
   */
  flyToPoints(points: THREE.Vector3[], nearTargetM?: number): void;
  readonly activeSite: string;
  onSiteChange(listener: (id: string) => void): () => void;
  /** Placement handle for live layers. */
  readonly placement: WorldPlacement;
  registerLayer(layer: LiveLayer): void;
  setLayerVisible(id: string, visible: boolean): void;
  /** Notified when the user clicks a pickable object, or clicks empty ground (null). */
  onPick(listener: (detail: PickDetail | null) => void): () => void;
  /** Dismiss the current selection from outside the scene, e.g. a close button. */
  clearPick(): void;
  /** Aborted when the world is disposed, so a layer can cancel work it started. */
  readonly signal: AbortSignal;
  debug(): Record<string, unknown>;
  dispose(): void;
}

interface CoreInstance {
  site: SiteConfig;
  assets: TerrainAssets;
  /** Offset of this core's centre from the world origin, in scene metres. */
  offset: THREE.Vector3;
  widthM: number;
  depthM: number;
  height: Uint16Array;
}

/**
 * How long the flight between two cores takes.
 *
 * ⚠️ AN INSTANT CUT IS INDISTINGUISHABLE FROM LOADING A DIFFERENT MAP — a user reported exactly
 * that on an earlier app in this family, which is why this is an eased flight with a lift rather
 * than a `setView`. The apex is what shows that the city and the airfield are on one continuous
 * piece of ground 28 km apart, which is the entire argument for having two cores in one scene.
 */
const FLIGHT_MS = 4200;
const FLIGHT_LIFT_CAP_M = 3200;

export async function createWorldMap(
  canvas: HTMLCanvasElement,
  onProgress: ProgressReporter,
  onTelemetry: (value: FlyTelemetry) => void,
  startSiteId: string,
  signal?: AbortSignal,
): Promise<WorldMap> {
  const cleanup: (() => void)[] = [];
  const textures = new Set<THREE.Texture>();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const release of cleanup.reverse()) release();
    for (const texture of textures) texture.dispose();
  };

  try {
    const request = new AbortController();
    const abort = () => request.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    cleanup.push(() => { request.abort(); signal?.removeEventListener('abort', abort); });

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    cleanup.push(() => renderer.dispose());
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();

    const materials: THREE.ShaderMaterial[] = [];
    const addSurface = (geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      scene.add(mesh);
      materials.push(material);
      for (const uniform of Object.values(material.uniforms)) {
        if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
      }
      cleanup.push(() => { geometry.dispose(); material.dispose(); });
      return mesh;
    };

    // ---------------------------------------------------------------- cores
    const readerFor = (id: string) =>
      createAssetReader(ASSET_BINDING, request.signal, id, `${import.meta.env.BASE_URL}terrain/${id}`);

    const cores: CoreInstance[] = [];
    const coreStats: { id: string; buildings: number; trees: number }[] = [];
    let originEasting = 0;
    let originNorthing = 0;

    for (const site of SITES) {
      const reader = await readerFor(site.id);
      const assets = await loadCore(reader, onProgress);
      for (const value of Object.values(assets)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
      for (const tile of assets.drapeTiles ?? []) textures.add(tile);
      if (!assets.drapeTexture && !assets.drapeTiles) {
        throw new Error(`Für ${site.name} fehlt das Luftbild.`);
      }

      const terrain = assets.terrain;
      const widthM = terrain.width * terrain.resolutionM;
      const depthM = terrain.height * terrain.resolutionM;
      const centreE = terrain.origin.easting + widthM / 2;
      const centreN = terrain.origin.northing + depthM / 2;
      if (cores.length === 0) { originEasting = centreE; originNorthing = centreN; }

      // North is -Z, matching the raster row order the whole pipeline uses.
      const offset = new THREE.Vector3(centreE - originEasting, 0, -(centreN - originNorthing));

      const heightData: unknown = assets.heightTexture.image.data;
      if (!(heightData instanceof Uint16Array)) {
        throw new Error('Terrain grid must use uint16 metre decoding.');
      }

      const surface = new THREE.PlaneGeometry(
        widthM, depthM, Math.floor(terrain.width / 2), Math.floor(terrain.height / 2));
      surface.rotateX(-Math.PI / 2);
      const mesh = addSurface(surface, createTerrainMaterial({
        terrain,
        heightTexture: assets.heightTexture,
        landuse: assets.landuse,
        landuseTexture: assets.landuseTexture,
        drapeTexture: assets.drapeTexture,
        drapeTiles: assets.drapeTiles,
        drapeTilePx: assets.drape.tiles
          ? { width: assets.drape.tiles.tileWidth, height: assets.drape.tiles.tileHeight }
          : null,
        transitionBandM: Math.min(250, Math.min(widthM, depthM) * 0.08),
        shellPhoto: true,
      }));
      mesh.position.copy(offset);

      const buildingReader = await readerFor(site.id);
      const buildings = await loadBuildings(buildingReader, onProgress);
      cleanup.push(() => buildings.dispose());
      buildings.mesh.position.copy(offset);
      scene.add(buildings.mesh);

      let treeCount = 0;
      if (site.hasVegetation) {
        const vegetationReader = await readerFor(site.id);
        const vegetation = await loadVegetation(vegetationReader, onProgress);
        if (!vegetation) throw new Error(`Für ${site.name} fehlt die Vegetation.`);
        cleanup.push(() => vegetation.dispose());
        vegetation.group.position.copy(offset);
        scene.add(vegetation.group);
        treeCount = vegetation.drawn;
      }

      cores.push({ site, assets, offset, widthM, depthM, height: heightData });
      coreStats.push({ id: site.id, buildings: buildings.meta.count, trees: treeCount });
      request.signal.throwIfAborted();
    }

    // ---------------------------------------------------------------- shell
    // ⚠️ ONE shell for the whole world, taken from the core whose AOI declares the union box.
    // See config/aoi/flughafen.json: two per-core shells 28 km apart leave a hole exactly where
    // the camera flies.
    const shellReader = await readerFor(WORLD_SHELL_SITE);
    const shellAssets = await loadShell(shellReader, onProgress);
    textures.add(shellAssets.shellTexture);
    textures.add(shellAssets.shellDrapeTexture);
    const shell = shellAssets.shell;
    const shellWidthM = shell.width * shell.resolutionM;
    const shellDepthM = shell.height * shell.resolutionM;

    const shellCores: ShellCore[] = cores.map((core) => ({
      meta: core.assets.terrain,
      texture: core.assets.heightTexture,
      rect: [
        core.offset.x - core.widthM / 2,
        core.offset.z - core.depthM / 2,
        core.widthM,
        core.depthM,
      ] as [number, number, number, number],
    }));

    const elevationRangeM = {
      min: Math.min(...cores.map((c) => c.assets.terrain.heightMinM)),
      max: Math.max(...cores.map((c) => c.assets.terrain.heightMaxM)),
    };

    const surround = new THREE.PlaneGeometry(
      shellWidthM, shellDepthM, Math.floor(shell.width / 3), Math.floor(shell.height / 3));
    surround.rotateX(-Math.PI / 2);
    const shellMesh = addSurface(surround, createShellMaterial({
      shell,
      shellTexture: shellAssets.shellTexture,
      cores: shellCores,
      elevationRangeM,
      shellDrapeTexture: shellAssets.shellDrapeTexture,
    }));
    shellMesh.position.set(
      shell.origin.easting + shellWidthM / 2 - originEasting,
      0,
      -(shell.origin.northing + shellDepthM / 2 - originNorthing),
    );
    const shellHeight: unknown = shellAssets.shellTexture.image.data;
    const shellGrid = shellHeight instanceof Uint16Array ? shellHeight : null;

    const sky = createSky();
    cleanup.push(() => sky.dispose());
    scene.add(sky.mesh);
    request.signal.throwIfAborted();

    // ------------------------------------------------------------- ground
    /**
     * Terrain elevation anywhere in the world.
     *
     * Cores first, because they are the survey; the shell is the fallback so that the 28 km
     * flight between them is over real ground rather than over nothing. Free flight needs this:
     * without the shell branch the drone's altitude-above-ground readout goes blank the moment it
     * leaves a core, which is most of the journey.
     */
    const groundAt = (x: number, z: number): number | null => {
      for (const core of cores) {
        const u = (x - core.offset.x) / core.widthM + 0.5;
        const v = (z - core.offset.z) / core.depthM + 0.5;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const meta = core.assets.terrain;
        const col = Math.min(meta.width - 1, Math.round(u * (meta.width - 1)));
        const row = Math.min(meta.height - 1, Math.round(v * (meta.height - 1)));
        return meta.heightMinM + core.height[row * meta.width + col] * meta.heightScale;
      }
      if (!shellGrid) return null;
      const u = (x - shellMesh.position.x) / shellWidthM + 0.5;
      const v = (z - shellMesh.position.z) / shellDepthM + 0.5;
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      const col = Math.min(shell.width - 1, Math.round(u * (shell.width - 1)));
      const row = Math.min(shell.height - 1, Math.round(v * (shell.height - 1)));
      return shell.heightMinM + shellGrid[row * shell.width + col] * shell.heightScale;
    };

    // ------------------------------------------------------------- camera
    // Survey elevations and horizontal distances both use metres. No axis is stretched.
    const camera = new THREE.PerspectiveCamera(42, 1, 2, 120000);
    const controls = new OrbitControls(camera, canvas);
    cleanup.push(() => controls.dispose());
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;
    controls.zoomSpeed = 0.7;
    controls.rotateSpeed = 0.55;
    controls.minDistance = 40;
    controls.maxDistance = 20000;
    controls.maxPolarAngle = Math.PI * 0.48;

    const drone = createFlyControls({
      camera, domElement: canvas, controls, groundAt,
      cruiseMinMs: 25, cruiseMaxMs: 900, cruiseDefaultMs: 180, boost: 3,
      accelerateTauS: 0.28, brakeTauS: 0.16, lookTauS: 0.07,
    });
    cleanup.push(() => drone.dispose());

    const anchorOf = (core: CoreInstance) => new THREE.Vector3(
      core.offset.x + (core.site.u - 0.5) * core.widthM,
      core.site.groundM,
      core.offset.z + (core.site.v - 0.5) * core.depthM,
    );
    const viewOf = (core: CoreInstance) => {
      const target = anchorOf(core);
      const range = core.site.rangeM;
      return { target, position: target.clone().add(new THREE.Vector3(0, range * 0.8, range * 0.65)) };
    };

    let activeSite = siteById(startSiteId) ? startSiteId : SITES[0].id;
    const siteListeners = new Set<(id: string) => void>();
    const announce = (id: string) => { for (const listener of siteListeners) listener(id); };

    const coreOf = (id: string) => cores.find((core) => core.site.id === id) ?? cores[0];

    const placeAt = (id: string) => {
      const { target, position } = viewOf(coreOf(id));
      drone.setEngaged(false);
      // Flush OrbitControls damping before replacing the target and view.
      controls.enableDamping = false;
      controls.update();
      controls.target.copy(target);
      camera.position.copy(position);
      controls.update();
      controls.enableDamping = true;
    };

    interface Flight { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; lift: number; startedAt: number; }
    let flight: Flight | null = null;

    const prefersReducedMotion = () =>
      typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const flyToSite = (id: string) => {
      const core = siteById(id) ? coreOf(id) : null;
      if (!core || core.site.id === activeSite) return;
      activeSite = core.site.id;
      announce(activeSite);
      if (prefersReducedMotion()) { placeAt(activeSite); return; }

      // ⚠️ Hand control back BEFORE flying. A flight requested while the drone latch is engaged
      // is overwritten by the latch every frame, so the camera simply does not move and the
      // switcher looks broken.
      drone.setEngaged(false);
      const { target, position } = viewOf(core);
      flight = {
        from: camera.position.clone(),
        to: position,
        fromTarget: controls.target.clone(),
        toTarget: target,
        lift: Math.min(position.distanceTo(camera.position) * 0.25, FLIGHT_LIFT_CAP_M),
        startedAt: performance.now(),
      };
    };

    const flyToPoints = (points: THREE.Vector3[], nearTargetM?: number) => {
      if (!points.length) return;

      let chosen = points;
      if (nearTargetM !== undefined) {
        const near = points.filter((point) => {
          // Horizontal distance only: a column's height must not make it count as far away.
          const dx = point.x - controls.target.x;
          const dz = point.z - controls.target.z;
          return Math.hypot(dx, dz) <= nearTargetM;
        });
        if (near.length) chosen = near;
      }

      const box = new THREE.Box3();
      for (const point of chosen) box.expandByPoint(point);
      const target = box.getCenter(new THREE.Vector3());
      // The radius of the sphere that contains every point, so the fit does not depend on which
      // way the camera happens to be facing.
      const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 200);

      // Fit against the NARROWER half-angle. The viewport is wider than it is tall here, but the
      // side panels eat a third of the width, so assuming the horizontal axis is the roomy one
      // is exactly how a fit ends up too tight in the real layout.
      const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
      const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
      // 1.35 leaves margin so the outermost column is not pinned to the edge of the frame.
      const distance = THREE.MathUtils.clamp(
        (radius * 1.35) / Math.tan(Math.min(vertical, horizontal)),
        controls.minDistance,
        controls.maxDistance,
      );

      // Keep the direction the user is already looking from; only close in or pull back.
      const direction = camera.position.clone().sub(controls.target);
      if (direction.lengthSq() < 1) direction.set(0, 0.8, 0.65);
      direction.normalize();
      const position = target.clone().addScaledVector(direction, distance);

      drone.setEngaged(false);
      if (prefersReducedMotion()) {
        controls.enableDamping = false;
        controls.update();
        controls.target.copy(target);
        camera.position.copy(position);
        controls.update();
        controls.enableDamping = true;
        return;
      }
      flight = {
        from: camera.position.clone(),
        to: position,
        fromTarget: controls.target.clone(),
        toTarget: target,
        lift: Math.min(position.distanceTo(camera.position) * 0.2, FLIGHT_LIFT_CAP_M),
        startedAt: performance.now(),
      };
    };

    // The user grabbing the map cancels the flight; fighting the camera is worse than a jump.
    const cancelFlight = () => { flight = null; };    controls.addEventListener('start', cancelFlight);
    cleanup.push(() => controls.removeEventListener('start', cancelFlight));

    const advanceFlight = (now: number) => {
      if (!flight) return;
      const t = Math.min((now - flight.startedAt) / FLIGHT_MS, 1);
      // Smootherstep: no velocity step at either end, unlike a raw cosine ease.
      const e = t * t * t * (t * (t * 6 - 15) + 10);
      camera.position.lerpVectors(flight.from, flight.to, e);
      camera.position.y += Math.sin(Math.PI * t) * flight.lift;
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
      if (t >= 1) flight = null;
    };

    placeAt(activeSite);

    // ------------------------------------------------------------- layers
    const layerGroup = new THREE.Group();
    layerGroup.name = 'live-layers';
    scene.add(layerGroup);

    // ⚠️ THE ONLY LIGHTS IN THIS SCENE, AND THEY EXIST FOR THE LIVE LAYERS ALONE.
    //
    // Terrain, buildings, the shell and the trees each bake their own shading in a custom shader
    // and ignore lights entirely. Anything added on top through a stock three.js material does
    // NOT — a MeshStandardMaterial in a scene with no lights renders black, which is how the
    // aircraft models came to be invisible against an orthophoto that already contains parked
    // aircraft from the survey flight. Repeating the surfaces' own sun vector here means the
    // aircraft are lit from the same direction as the ground they stand on.
    const sun = new THREE.DirectionalLight(new THREE.Color(...SUN_TINT), 1.5);
    sun.position.set(...SUN_DIRECTION);
    scene.add(sun);
    const ambient = new THREE.AmbientLight(new THREE.Color(...SHADOW_TINT), 1.6);
    scene.add(ambient);
    cleanup.push(() => { scene.remove(sun); scene.remove(ambient); sun.dispose(); ambient.dispose(); });

    const layers = new Map<string, LiveLayer>();
    cleanup.push(() => {
      for (const layer of layers.values()) layer.dispose();
      layers.clear();
      scene.remove(layerGroup);
    });

    const placement: WorldPlacement = {
      group: layerGroup,
      toWorld(latDeg, lonDeg, altitudeM) {
        const { easting, northing } = wgs84ToUtm32(latDeg, lonDeg);
        return placement.toWorldUtm(easting, northing, altitudeM);
      },
      toWorldUtm(easting, northing, altitudeM) {
        const x = easting - originEasting;
        const z = -(northing - originNorthing);
        const y = altitudeM ?? groundAt(x, z) ?? elevationRangeM.min;
        return new THREE.Vector3(x, y, z);
      },
      coreBboxUtm(siteId) {
        const core = cores.find((entry) => entry.site.id === siteId);
        if (!core) return null;
        const meta = core.assets.terrain;
        return {
          minE: meta.origin.easting,
          minN: meta.origin.northing,
          maxE: meta.origin.easting + core.widthM,
          maxN: meta.origin.northing + core.depthM,
        };
      },
      worldBoundsM: [
        shellMesh.position.x - shellWidthM / 2,
        shellMesh.position.z - shellDepthM / 2,
        shellMesh.position.x + shellWidthM / 2,
        shellMesh.position.z + shellDepthM / 2,
      ] as const,
      groundAt,
      invalidate() { /* the app renders continuously; kept so layers need not know that. */ },
    };

    // ------------------------------------------------------------- picking
    /**
     * Click-to-inspect over the live layers.
     *
     * ⚠️ A CLICK IS NOT A POINTERUP. This canvas is an orbit control: almost every press is the
     * start of a drag, and treating pointerup as a selection would pop a panel open every time
     * the user turns the map. A selection requires the pointer to have travelled less than a few
     * pixels and to have been down only briefly.
     *
     * ⚠️ Only `layerGroup` is tested, never the terrain or the buildings. Raycasting the city
     * core means testing 3.4 million triangles on every click; the live layers are a few thousand
     * at most, and they are the only things that carry details worth showing.
     */
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pickListeners = new Set<(detail: PickDetail | null) => void>();
    let selected: PickDetail | null = null;

    const emitPick = (detail: PickDetail | null) => {
      selected = detail;
      for (const layer of layers.values()) layer.onPicked?.(detail);
      for (const listener of pickListeners) listener(detail);
    };

    let pressAt: { x: number; y: number; time: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pressAt = { x: event.clientX, y: event.clientY, time: performance.now() };
    };
    const onPointerUp = (event: PointerEvent) => {
      const press = pressAt;
      pressAt = null;
      if (!press || event.button !== 0) return;
      const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      if (moved > 4 || performance.now() - press.time > 600) return;
      if (drone.engaged) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      // ⚠️ ONLY THE GROUPS THAT ARE ACTUALLY SHOWN. Three.js's raycaster does NOT skip objects
      // with `visible === false`, and every layer here keeps its geometry when switched off so
      // that toggling it back on is instant. Without this filter, switching a layer off and
      // clicking where one of its features used to be reopens that feature's detail panel, on
      // top of a map that no longer shows it.
      const pickable = layerGroup.children.filter((child) => child.visible);
      const hits = raycaster.intersectObjects(pickable, true);
      for (const hit of hits) {
        // The detail lives on whichever ancestor declared it, because a glTF aircraft is a tree
        // of meshes and the hit is one leaf of it.
        let node: THREE.Object3D | null = hit.object;
        while (node) {
          const detail = node.userData?.pick as PickDetail | undefined;
          if (detail) { emitPick(detail); return; }
          node = node.parent;
        }
      }
      // Clicking bare ground dismisses the panel, which is what people expect from a map.
      if (selected) emitPick(null);
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    cleanup.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      pickListeners.clear();
    });

    // ------------------------------------------------------------ rendering
    const resize = () => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    cleanup.push(() => observer.disconnect());
    resize();

    let frames = 0;
    let frameRequest = 0;
    let lastTime = performance.now();
    let lastHud = 0;
    const draw = () => {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      advanceFlight(now);
      if (drone.engaged) drone.update(dt);
      else controls.update();
      for (const layer of layers.values()) layer.update?.(dt, camera);
      sky.update(camera);
      for (const material of materials) material.uniforms.uCameraWorld.value.copy(camera.position);
      renderer.render(scene, camera);
      frames++;
      if (now - lastHud > 100) { onTelemetry(drone.telemetry()); lastHud = now; }
      frameRequest = requestAnimationFrame(draw);
    };
    cleanup.push(() => cancelAnimationFrame(frameRequest));
    draw();

    return {
      reset() {
        // ⚠️ Cancel any flight first. Without this the next frame's `advanceFlight` overwrites the
        // camera that reset() just placed, and the home button appears to do nothing mid-flight.
        flight = null;
        placeAt(activeSite);
      },
      faceNorth() {
        if (drone.engaged) { drone.faceNorth(); return; }
        flight = null;
        controls.enableDamping = false;
        controls.update();
        const delta = camera.position.clone().sub(controls.target);
        camera.position.set(controls.target.x, camera.position.y, controls.target.z + Math.hypot(delta.x, delta.z));
        controls.update();
        controls.enableDamping = true;
      },
      flyToSite,
      flyToPoints,
      get activeSite() { return activeSite; },
      onSiteChange(listener) {
        siteListeners.add(listener);
        return () => siteListeners.delete(listener);
      },
      placement,
      signal: request.signal,
      registerLayer(layer) {
        // ⚠️ A LAYER CAN FINISH BUILDING AFTER THE WORLD IS GONE. The aircraft layer awaits five
        // model files before it returns, and a WebGL context loss during that wait disposes the
        // world underneath it. Registering then would attach a group to a dead scene and start a
        // polling interval nothing will ever clear.
        if (disposed) { layer.dispose(); return; }
        layers.get(layer.id)?.dispose();
        layers.set(layer.id, layer);
      },
      setLayerVisible(id, visible) {
        if (disposed) return;
        const layer = layers.get(id);
        if (!layer) return;
        layer.setVisible(visible);
        // A selection belonging to a layer that was just switched off must not outlive it.
        if (!visible && selected?.layerId === id) emitPick(null);
      },
      onPick(listener) {
        pickListeners.add(listener);
        return () => pickListeners.delete(listener);
      },
      clearPick() { if (selected) emitPick(null); },
      debug: () => ({
        frames,
        sites: coreStats,
        activeSite,
        flying: drone.engaged,
        inFlight: flight !== null,
        hasDrape: cores.every((core) => Boolean(core.assets.drapeTexture || core.assets.drapeTiles)),
        drapeTilesPerCore: cores.map((core) => core.assets.drapeTiles?.length ?? 1),
        rastersShareOrientation: [...textures].filter(t => (t.image?.width ?? 0) > 1).every(t => !t.flipY),
        heading: drone.engaged ? drone.telemetry().headingDeg : headingFromAzimuth(controls.getAzimuthalAngle()) * 180 / Math.PI,
        camera: camera.position.toArray(),
        target: controls.target.toArray(),
        coreSeparationM: cores.length > 1 ? Math.round(cores[0].offset.distanceTo(cores[1].offset)) : 0,
        shellSpanM: [shellWidthM, shellDepthM],
        layers: [...layers.keys()],
        /**
         * Bounding-box size of one drawn feature per layer, in metres [x, y, z].
         *
         * ⚠️ THIS EXISTS BECAUSE A SCREENSHOT COULD NOT SETTLE THE QUESTION. The aircraft models
         * are authored Z-up and are rotated into the scene's Y-up axes at load. A placement bug
         * silently undid that rotation and stood every airliner on its wingtips, and it was not
         * detectable by eye because the orthophoto already contains parked aircraft from the
         * survey flight. For a correctly oriented airliner the HEIGHT (y) must be far smaller
         * than the WINGSPAN (z): roughly 10 m against 36 m for the narrow-body model. If y and z
         * are swapped, the axis correction has been lost again.
         */
        layerSampleSizes: Object.fromEntries(
          layerGroup.children
            .filter((group) => group.children.length > 0)
            .map((group) => {
              const size = new THREE.Box3()
                .setFromObject(group.children[0])
                .getSize(new THREE.Vector3());
              return [group.name, [size.x, size.y, size.z].map((v) => Math.round(v * 10) / 10)];
            }),
        ),
        triangles: renderer.info.render.triangles,
      }),
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
