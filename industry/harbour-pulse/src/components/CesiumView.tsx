import {
  Cartesian2,
  Cartesian3,
  CameraEventType,
  Color,
  Credit,
  createGooglePhotorealistic3DTileset,
  createOsmBuildingsAsync,
  defined,
  HeadingPitchRoll,
  HeightReference,
  ImageryLayer,
  Ion,
  KeyboardEventModifier,
  Math as CesiumMath,
  Matrix4,
  OpenStreetMapImageryProvider,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Terrain,
  Transforms,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
  type Entity,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { DroneHud } from '@/components/DroneHud';
import { createFlyControls, type FlyControls, type FlyTelemetry } from '@/cesium/flyControls';
import { addBakedCity, loadBakedCity } from '@/cesium/bakedCity';
import { BakedTerrainProvider, loadTerrainGrid } from '@/cesium/bakedTerrain';
import {
  GEOID_OFFSET_M,
  IMAGERY_MODES,
  modeInfo,
  NSW_BOUNDS,
  NSW_CREDIT,
  NSW_IMAGERY_TILE_TEMPLATE,
  type ImageryMode,
} from '@/cesium/imageryModes';
import { fetchFerries, fetchReferenceLocations } from '@/services/ferryService';
import { KustoInteractionRequiredError } from '@/services/kustoClient';
import { CONFIG } from '@/shared/config';
import { type HeroFerry } from '@/shared/contract';

// A free Cesium Ion token (ion.cesium.com) unlocks world terrain, Cesium OSM
// Buildings and Google Photorealistic 3D Tiles. Without it we fall back to
// keyless OpenStreetMap imagery + our own OSM building extrusions.
const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN;

// Photoreal 3D is key-gated: it streams Google's tiles through Cesium ion. The
// keyless path needs no account at all, so the toggle can always turn photoreal
// *off*, but can only turn it *on* when a token was built into the bundle.
const CAN_PHOTOREAL = Boolean(ION_TOKEN);

// Modes that this build can actually offer — the ion one disappears entirely without a token
// rather than sitting there greyed out promising something the bundle cannot deliver.
const AVAILABLE_MODES = IMAGERY_MODES.filter((m) => !m.needsIonToken || CAN_PHOTOREAL);

// Best available on first paint: the photoreal mesh if we have the key, otherwise real aerial
// photography. Plain OSM is a deliberate choice now, never somewhere you land by default.
const DEFAULT_MODE: ImageryMode = CAN_PHOTOREAL ? 'ion' : 'nsw';

// Real 3D ferry model (glTF). Ships a bundled stylised Emerald-class vessel;
// point VITE_FERRY_MODEL_URL at any .glb to swap in a higher-fidelity model.
const FERRY_MODEL_URL = import.meta.env.VITE_FERRY_MODEL_URL || '/models/ferry.glb';
const FERRY_HEIGHT_M = 23; // Sydney sea level ≈ +22 m ellipsoidal (geoid offset)
const HEADING_OFFSET_DEG = -90; // model bow is authored along +Z

function bearing(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const dλ = toRad(b[0] - a[0]);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dφ = toRad(b[1] - a[1]);
  const dλ = toRad(b[0] - a[0]);
  const s =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Opening (and "reset") camera pose over Circular Quay.
const HOME = { lon: 151.2075, lat: -33.88, height: 2600, headingDeg: 0, pitchDeg: -35 };

function flyHome(viewer: Viewer, duration = 1.4): void {
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(HOME.lon, HOME.lat, HOME.height),
    orientation: {
      heading: CesiumMath.toRadians(HOME.headingDeg),
      pitch: CesiumMath.toRadians(HOME.pitchDeg),
      roll: 0,
    },
    duration,
  });
}

/** Swoop the camera down to an oblique close-up of a point (a ferry). */
function flyToPoint(viewer: Viewer, lon: number, lat: number): void {
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(lon, lat - 0.0028, 180),
    orientation: { heading: 0, pitch: CesiumMath.toRadians(-26), roll: 0 },
    duration: 1.4,
  });
}

/** Orbit the camera around whatever point is under the screen centre. */
function orbit(viewer: Viewer, headingDelta: number, pitchDelta: number): void {
  const scene = viewer.scene;
  const canvas = scene.canvas;
  const centre = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  let target: Cartesian3 | undefined = scene.pickPosition(centre);
  if (!defined(target)) {
    const ray = viewer.camera.getPickRay(centre);
    target = ray ? scene.globe.pick(ray, scene) : undefined;
  }
  const camera = viewer.camera;
  if (defined(target)) {
    camera.lookAtTransform(Transforms.eastNorthUpToFixedFrame(target));
    if (headingDelta) camera.rotateRight(headingDelta);
    if (pitchDelta) camera.rotateUp(pitchDelta);
    camera.lookAtTransform(Matrix4.IDENTITY);
  } else {
    if (headingDelta) camera.rotateRight(headingDelta);
    if (pitchDelta) camera.rotateUp(pitchDelta);
  }
}

function zoom(viewer: Viewer, inward: boolean): void {
  const amount = Math.max(50, viewer.camera.positionCartographic.height * 0.35);
  if (inward) viewer.camera.zoomIn(amount);
  else viewer.camera.zoomOut(amount);
}

const HEADING_STEP = CesiumMath.toRadians(15);
const PITCH_STEP = CesiumMath.toRadians(8);

interface Anim {
  prev: [number, number];
  target: [number, number];
  start: number;
}

export interface CesiumHandle {
  /** Fly the camera to an oblique close-up over a ferry's position. */
  flyToFerry(lon: number, lat: number): void;
  /** Switch the world between OpenStreetMap, NSW aerial and photoreal 3D. */
  setImagery(mode: ImageryMode): void;
}

export interface CesiumStatus {
  count: number;
  asOf: string | null;
  /** Which of the three worlds is currently drawn. */
  imagery: ImageryMode;
  /** The modes this build can offer — excludes photoreal when no Ion token was compiled in. */
  available: ImageryMode[];
  /** True when live data needs a one-time interactive sign-in. */
  needsAuth: boolean;
}

interface CesiumViewProps {
  /** Reports the live ferry count / freshness so the app chrome can show it. */
  onStatus?: (s: CesiumStatus) => void;
  /** Fired when a ferry is clicked — opens the full-screen voxel ferry view. */
  onSelectFerry?: (ferry: { id: string; name: string }) => void;
}

export const CesiumView = forwardRef<CesiumHandle, CesiumViewProps>(function CesiumView(
  { onStatus, onSelectFerry },
  ref,
) {
  const div = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const flyRef = useRef<FlyControls | null>(null);
  const [count, setCount] = useState(0);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [autoOrbit, setAutoOrbit] = useState(false);
  // Mirrors the latch. ⚠️ Set only from `onEngagedChange` — the keys own the latch, so any state
  // the UI sets itself is wrong the moment someone presses W.
  const [flying, setFlying] = useState(false);
  // Runtime-switchable: rebuilding the Viewer is the only reliable way to swap
  // base imagery *and* terrain provider together, so the switch re-runs the
  // whole scene effect below rather than mutating a live scene.
  const [imagery, setImageryState] = useState<ImageryMode>(DEFAULT_MODE);
  // Camera pose carried across a rebuild so toggling doesn't yank the user home.
  const camRestore = useRef<{ destination: Cartesian3; heading: number; pitch: number; roll: number } | null>(
    null,
  );

  // Bubble live status up to the app shell (kept in a ref so the effect below
  // always calls the latest callback without re-subscribing).
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const onSelectFerryRef = useRef(onSelectFerry);
  onSelectFerryRef.current = onSelectFerry;
  useEffect(() => {
    onStatusRef.current?.({
      count,
      asOf,
      imagery,
      available: AVAILABLE_MODES.map((m) => m.id),
      needsAuth,
    });
  }, [count, asOf, imagery, needsAuth]);

  useEffect(() => {
    // ⚠️ `Ion.defaultAccessToken` is a GLOBAL that survives the Viewer being torn down, so setting
    // it in ion mode and simply not setting it elsewhere is NOT enough — measured live, the token
    // was still installed after switching to NSW aerial. Assign it every time, blanking it in the
    // keyless modes, so "no API key in use" is a fact about the network tab rather than a claim in
    // a tooltip regardless of which order the user visits the modes in.
    Ion.defaultAccessToken = imagery === 'ion' && ION_TOKEN ? ION_TOKEN : '';

    // Google's mesh carries its own colour, so photoreal wants no base imagery underneath it at
    // all. The other two each get a raster base.
    const baseImagery =
      imagery === 'osm'
        ? new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })
        : imagery === 'nsw'
          ? new UrlTemplateImageryProvider({
              url: NSW_IMAGERY_TILE_TEMPLATE,
              // The cache stops here; asking deeper returns nothing and just stalls the tile queue.
              maximumLevel: 20,
              // Confine requests to NSW. Beyond the state the service has no coverage, so without
              // this every camera move anywhere on Earth fires doomed requests at it.
              rectangle: Rectangle.fromDegrees(
                NSW_BOUNDS.west,
                NSW_BOUNDS.south,
                NSW_BOUNDS.east,
                NSW_BOUNDS.north,
              ),
              credit: new Credit(NSW_CREDIT),
              enablePickFeatures: false,
            })
          : null;

    const viewer = new Viewer(div.current!, {
      // Allow screenshots / toDataURL of the WebGL canvas.
      contextOptions: { webgl: { preserveDrawingBuffer: true } },
      baseLayer: baseImagery
        ? ImageryLayer.fromProviderAsync(Promise.resolve(baseImagery), {})
        : undefined,
      // World terrain is an ion asset, so only photoreal gets relief. The other two sit on the
      // ellipsoid — which costs nothing here, because this is a harbour at sea level.
      terrain: imagery === 'ion' ? Terrain.fromWorldTerrain() : undefined,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      timeline: false,
      animation: false,
      infoBox: false,
      selectionIndicator: false,
    });
    viewer.scene.globe.enableLighting = true;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    // NSW imagery stops at the state border. Painting the bare globe a deep ocean blue makes the
    // edge read as "coverage ends here" rather than as tiles that failed to load.
    if (imagery === 'nsw') viewer.scene.globe.baseColor = Color.fromCssColorString('#0a1826');

    // ⚠️ EXACTLY ONE credit surface per mode, or they overlap and both become unreadable — which
    // is what two rounds of nudging pixel offsets kept producing.
    //  • keyless: we render the line ourselves (see `map-attribution` below), so Cesium's container
    //    is hidden. Nothing is lost: our line names all three sources it would have listed, and
    //    CesiumJS itself is Apache-2.0 with no logo requirement.
    //  • photoreal: Cesium's container STAYS, because it carries Google's and ion's own required
    //    logos. main.css moves it clear of the Fleet panel, which was covering it entirely.
    if (imagery !== 'ion') {
      const credits = viewer.cesiumWidget.creditContainer as HTMLElement;
      credits.style.display = 'none';
    }
    viewerRef.current = viewer;

    // Set once the baked city lands; called on teardown so a mode switch does not leak primitives.
    let disposeCity: (() => void) | null = null;

    /*
     * ── Map navigation, matching the other twins ────────────────────────────────────────────
     *
     * Those apps run Three.js `OrbitControls`, whose bindings are the muscle memory to preserve:
     *
     *   left drag                 orbit around the target
     *   Shift / Ctrl + left drag  pan
     *   right drag                pan
     *   wheel, middle drag        zoom
     *
     * ⚠️ CESIUM NAMES THESE THE OTHER WAY ROUND, which is the trap. In a 3D scene Cesium's
     * `rotate` is the one that carries you ACROSS the globe — it spins the ellipsoid under the
     * camera, so it is the *pan* — while `tilt` swings the camera around the picked point, which
     * is the *orbit*. Binding by the name rather than by the behaviour gets it exactly backwards.
     *
     * ⚠️ `lookEventTypes` MUST BE CLEARED. Cesium binds free-look to Shift+left by default, which
     * is precisely the chord being claimed for pan; left as-is the two fight and the view yaws
     * instead of moving. Free look belongs to the drone, and only while it is engaged.
     */
    const camCtrl = viewer.scene.screenSpaceCameraController;
    camCtrl.tiltEventTypes = [CameraEventType.LEFT_DRAG, CameraEventType.PINCH];
    camCtrl.rotateEventTypes = [
      CameraEventType.RIGHT_DRAG,
      { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.SHIFT },
      { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.CTRL },
    ];
    camCtrl.zoomEventTypes = [
      CameraEventType.WHEEL,
      CameraEventType.MIDDLE_DRAG,
      CameraEventType.PINCH,
    ];
    camCtrl.lookEventTypes = [];

    // The deliberate, slightly damped feel of the other twins (OrbitControls `dampingFactor 0.08`)
    // rather than Cesium's very slidey default.
    camCtrl.inertiaSpin = 0.7;
    camCtrl.inertiaTranslate = 0.7;
    camCtrl.inertiaZoom = 0.7;

    // `minDistance` / `maxDistance` from those apps, rescaled for a harbour rather than a valley.
    // Collision detection is what stops the orbit dropping through the water and looking up at the
    // underside of the scene, which reads as a rendering fault rather than a viewpoint.
    camCtrl.minimumZoomDistance = 60;
    camCtrl.maximumZoomDistance = 40_000;
    camCtrl.enableCollisionDetection = true;

    // ── Free flight ─────────────────────────────────────────────────────────
    // The same merged map+drone camera the other twins use: no button, the keys are the control.
    // Inertia and gimbal lag match the Campus/Gleitschirm feel (0.28 / 0.16 / 0.07) rather than
    // the rigid Flut default — this is a harbour to fly over, not a flood plain to inspect.
    const fly = createFlyControls({
      scene: viewer.scene,
      camera: viewer.camera,
      canvas: viewer.scene.canvas,
      cruiseMinMs: 25,
      cruiseMaxMs: 900,
      cruiseDefaultMs: 180,
      boost: 3,
      accelerateTauS: 0.28,
      brakeTauS: 0.16,
      lookTauS: 0.07,
      onEngagedChange: (on) => {
        setFlying(on);
        // ⚠️ Engaging must cancel everything else that drives the camera, or the auto-orbit keeps
        // rotating the view out from under the pilot.
        if (on) setAutoOrbit(false);
      },
    });
    flyRef.current = fly;

    /*
     * ── Orbit limit ────────────────────────────────────────────────────────────────────────
     *
     * `OrbitControls` clamps the polar angle, so an orbit stops dead just short of the target's
     * horizon and can never sail over the zenith. Cesium's tilt has NO equivalent property, and
     * measured live it will happily go over the top: one long upward drag left the camera at
     * heading 180°, roll 180° — silently inverted, and every later drag then reads mirrored.
     *
     * There is nothing to configure, so the limit is enforced by holding the last legal pose and
     * snapping back to it on the first frame that leaves the range. Motion stops at the boundary
     * the way it does in the other twins, instead of tumbling past it.
     *
     * ⚠️ Not while flying. A drone legitimately pitches up and rolls; clamping then would fight
     * the pilot for the camera every single frame.
     */
    const MIN_PITCH = CesiumMath.toRadians(-89.5); // straight down
    const MAX_PITCH = CesiumMath.toRadians(-3.6); // == OrbitControls' `maxPolarAngle` of PI * 0.48
    const MAX_ROLL = CesiumMath.toRadians(1);
    let lastLegal: { position: Cartesian3; heading: number; pitch: number } | null = null;
    const clampOrbit = () => {
      if (flyRef.current?.engaged) {
        lastLegal = null; // the pilot's pose is not a map pose; don't snap back to it later
        return;
      }
      const cam = viewer.camera;
      const legal =
        cam.pitch >= MIN_PITCH &&
        cam.pitch <= MAX_PITCH &&
        Math.abs(CesiumMath.negativePiToPi(cam.roll)) <= MAX_ROLL;
      if (legal) {
        lastLegal = {
          position: Cartesian3.clone(cam.positionWC, lastLegal?.position),
          heading: cam.heading,
          pitch: cam.pitch,
        };
      } else if (lastLegal) {
        cam.setView({
          destination: lastLegal.position,
          orientation: { heading: lastLegal.heading, pitch: lastLegal.pitch, roll: 0 },
        });
      } else {
        // No anchor to return to — this is the hand-back from a flight that ended nose-up, outside
        // the map's range. Ease the pitch to the nearest legal value and keep everything else the
        // pilot chose. Measured: +0.3° becomes -3.6°, a correction too small to read as a jump,
        // and the map is never left sitting in a pose its own guard considers illegal.
        const pitch = CesiumMath.clamp(cam.pitch, MIN_PITCH, MAX_PITCH);
        lastLegal = { position: Cartesian3.clone(cam.positionWC), heading: cam.heading, pitch };
        cam.setView({
          destination: lastLegal.position,
          orientation: { heading: lastLegal.heading, pitch, roll: 0 },
        });
      }
    };
    viewer.scene.preRender.addEventListener(clampOrbit);

    const abort = new AbortController();
    const shapes = new Map<string, Entity>();
    const anim = new Map<string, Anim>();
    const meta = new Map<string, HeroFerry>();
    const lastSample = new Map<string, { lon: number; lat: number; t: number }>();
    let poller = 0;
    let raf = 0;
    let disposed = false;

    // ── Fly to an oblique view over Circular Quay ────────────────────────────
    // …unless we're rebuilding after a basemap toggle, in which case resume
    // exactly where the user was looking.
    const resume = camRestore.current;
    camRestore.current = null;
    viewer.camera.setView(
      resume
        ? {
            destination: resume.destination,
            orientation: { heading: resume.heading, pitch: resume.pitch, roll: resume.roll },
          }
        : {
            destination: Cartesian3.fromDegrees(HOME.lon, HOME.lat, HOME.height),
            orientation: {
              heading: CesiumMath.toRadians(HOME.headingDeg),
              pitch: CesiumMath.toRadians(HOME.pitchDeg),
              roll: 0,
            },
          },
    );

    // ── Buildings, trees and terrain ─────────────────────────────────────────
    if (imagery === 'ion') {
      // Google Photorealistic 3D Tiles give the true "wow" city mesh.
      void createGooglePhotorealistic3DTileset()
        .then((ts) => viewer.scene.primitives.add(ts))
        .catch(() => {
          // Fall back to Cesium OSM Buildings if Google tiles aren't enabled.
          void createOsmBuildingsAsync()
            .then((ts) => viewer.scene.primitives.add(ts))
            .catch(() => {/* ignore */});
        });
    } else {
      // ── Keyless: the baked city ───────────────────────────────────────────
      // Real footprints and heights, roofs coloured from the aerial photograph, real mapped trees,
      // and relief from a baked DEM — the same recipe as the campus twins, which is what stops
      // this reading as a diagram. All committed to the bundle: no key, and nothing at runtime
      // that a third party can take away mid-demo.
      void loadTerrainGrid('/data/terrain-sydney.json', '/data/terrain-sydney.bin', abort.signal)
        .then((grid) => {
          if (viewer.isDestroyed()) return;
          viewer.terrainProvider = new BakedTerrainProvider(
            grid,
            GEOID_OFFSET_M,
            'Elevation: AWS Open Data Terrain Tiles / Geoscience Australia',
          ) as unknown as typeof viewer.terrainProvider;
        })
        .catch(() => {/* terrain is an enhancement — the scene still works flat */});

      void loadBakedCity(abort.signal)
        .then((city) => {
          if (viewer.isDestroyed()) return;
          disposeCity = addBakedCity(viewer.scene, city, viewer.creditDisplay);
        })
        .catch(() => {/* buildings optional */});
    }

    // ── Wharves ──────────────────────────────────────────────────────────────
    void fetchReferenceLocations(abort.signal).then((r) => {
      for (const l of r.locations) {
        viewer.entities.add({
          position: Cartesian3.fromDegrees(l.lon, l.lat),
          point: { pixelSize: 7, color: Color.fromCssColorString('#6b4f2a'), outlineColor: Color.WHITE, outlineWidth: 1.5, heightReference: HeightReference.CLAMP_TO_GROUND },
          label: {
            text: l.name,
            font: '12px sans-serif',
            fillColor: Color.fromCssColorString('#f4e9c8'),
            outlineColor: Color.fromCssColorString('#000000'),
            outlineWidth: 3,
            style: 2, // FILL_AND_OUTLINE
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian3(0, -12, 0),
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
        });
      }
    });

    // ── Ferries: click to zoom the camera onto the vessel ────────────────────
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(e.position);
      const id = picked?.id?.id as string | undefined;
      const a = id ? anim.get(id) : undefined;
      if (a) {
        // Same reason as the camera buttons: a flyTo started while flying is overwritten frame by
        // frame, so clicking a ferry mid-flight would silently do nothing.
        fly.setEngaged(false);
        flyToPoint(viewer, a.target[0], a.target[1]);
        // Open the full-screen voxel ferry view for the clicked vessel.
        const info = id ? meta.get(id) : undefined;
        if (id) onSelectFerryRef.current?.({ id, name: info?.name ?? id });
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    const poll = async () => {
      try {
        const feed = await fetchFerries(abort.signal);
        if (disposed) return;
        const now = performance.now();
        const seen = new Set<string>();
        for (const f of feed.ferries) {
          seen.add(f.id);
          const target: [number, number] = [f.lon, f.lat];
          const prevS = lastSample.get(f.id);
          const moved = !prevS || prevS.lon !== f.lon || prevS.lat !== f.lat;
          let speedKn = meta.get(f.id)?.speedKn;
          if (prevS && moved) {
            const dtH = (Date.now() - prevS.t) / 3_600_000;
            if (dtH > 0) speedKn = haversineM([prevS.lon, prevS.lat], target) / 1852 / dtH;
          }
          if (moved) lastSample.set(f.id, { lon: f.lon, lat: f.lat, t: Date.now() });

          let headingDeg = meta.get(f.id)?.headingDeg ?? 0;
          const existing = shapes.get(f.id);
          if (existing) {
            const cur = anim.get(f.id)?.target ?? target;
            if (cur[0] !== target[0] || cur[1] !== target[1]) headingDeg = bearing(cur, target);
            anim.set(f.id, { prev: cur, target, start: now });
          } else {
            const ent = viewer.entities.add({
              id: f.id,
              position: Cartesian3.fromDegrees(target[0], target[1], FERRY_HEIGHT_M),
              model: {
                uri: FERRY_MODEL_URL,
                minimumPixelSize: 56,
                maximumScale: 400,
                scale: 1,
              },
              label: {
                text: f.name,
                font: '11px sans-serif',
                fillColor: Color.WHITE,
                outlineColor: Color.fromCssColorString('#0a1826'),
                outlineWidth: 3,
                style: 2,
                verticalOrigin: VerticalOrigin.BOTTOM,
                pixelOffset: new Cartesian3(0, -22, 0),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            });
            shapes.set(f.id, ent);
            anim.set(f.id, { prev: target, target, start: now });
          }

          meta.set(f.id, {
            id: f.id,
            name: f.name,
            destination: f.destination,
            headingDeg,
            speedKn,
            lastSeenMs: f.ts,
          });
        }
        for (const [id, ent] of shapes) {
          if (!seen.has(id)) {
            viewer.entities.remove(ent);
            shapes.delete(id);
            anim.delete(id);
          }
        }
        setCount(shapes.size);
        setAsOf(feed.asOf);
        setError(null);
        setNeedsAuth(false);
      } catch (err) {
        if (disposed) return;
        if (err instanceof KustoInteractionRequiredError) {
          setNeedsAuth(true);
        } else {
          setError((err as Error).message);
        }
      }
    };
    void poll();
    poller = window.setInterval(poll, CONFIG.pollMs);

    // Smoothly interpolate ferry positions + orient models to heading.
    let lastTick = performance.now();
    const tick = () => {
      if (disposed) return;
      const now = performance.now();
      // ⚠️ A REAL DELTA, CLAMPED. The fly camera integrates velocity, so a backgrounded tab that
      // resumes with a 4-second gap would teleport it several kilometres on the first frame.
      const dt = Math.min(0.1, (now - lastTick) / 1000);
      lastTick = now;
      fly.update(dt);
      for (const [id, a] of anim) {
        const t = Math.min(1, (now - a.start) / CONFIG.pollMs);
        const lon = a.prev[0] + (a.target[0] - a.prev[0]) * t;
        const lat = a.prev[1] + (a.target[1] - a.prev[1]) * t;
        const ent = shapes.get(id);
        if (!ent) continue;
        const pos = Cartesian3.fromDegrees(lon, lat, FERRY_HEIGHT_M);
        ent.position = pos as unknown as Entity['position'];
        const hd = meta.get(id)?.headingDeg ?? 0;
        const hpr = new HeadingPitchRoll(CesiumMath.toRadians(hd + HEADING_OFFSET_DEG), 0, 0);
        ent.orientation = Transforms.headingPitchRollQuaternion(pos, hpr) as unknown as Entity['orientation'];
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      abort.abort();
      window.clearInterval(poller);
      cancelAnimationFrame(raf);
      handler.destroy();
      fly.dispose();
      flyRef.current = null;
      disposeCity?.();
      disposeCity = null;
      // Remember where the camera was so a basemap toggle is seamless.
      if (!viewer.isDestroyed()) {
        camRestore.current = {
          destination: Cartesian3.clone(viewer.camera.positionWC),
          heading: viewer.camera.heading,
          pitch: viewer.camera.pitch,
          roll: viewer.camera.roll,
        };
      }
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [imagery]);

  // Continuous auto-orbit while enabled.
  useEffect(() => {
    if (!autoOrbit || flying) return;
    const id = window.setInterval(() => {
      const v = viewerRef.current;
      if (v) orbit(v, CesiumMath.toRadians(0.2), 0);
    }, 30);
    return () => window.clearInterval(id);
  }, [autoOrbit, flying]);

  const readTelemetry = useCallback((): FlyTelemetry | null => flyRef.current?.telemetry() ?? null, []);

  /**
   * ⚠️ EVERY SCRIPTED CAMERA MOVE MUST HAND BACK FIRST. While the latch is engaged the fly
   * controls call `setView` on every frame, so a `flyTo` started underneath one is overwritten
   * before its first step lands — the click appears to do nothing at all.
   */
  const handBack = () => flyRef.current?.setEngaged(false);

  const nudge = (headingDelta: number, pitchDelta: number) => {
    handBack();
    const v = viewerRef.current;
    if (v) orbit(v, headingDelta, pitchDelta);
  };
  const doZoom = (inward: boolean) => {
    handBack();
    const v = viewerRef.current;
    if (v) zoom(v, inward);
  };
  const resetView = () => {
    handBack();
    const v = viewerRef.current;
    if (v) flyHome(v);
  };
  const flyToFerry = (lon: number, lat: number) => {
    handBack();
    const v = viewerRef.current;
    if (v) flyToPoint(v, lon, lat);
  };
  // Only ever accept a mode this build can actually draw, whoever asks for it.
  const setImagery = (mode: ImageryMode) => {
    if (AVAILABLE_MODES.some((m) => m.id === mode)) setImageryState(mode);
  };
  useImperativeHandle(ref, () => ({ flyToFerry, setImagery }), []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0a1826]">
      <div ref={div} className="h-full w-full" />

      <DroneHud read={readTelemetry} />

      {/* ⚠️ WITHOUT THIS THE MERGE IS INVISIBLE. There is no drone button — the keys are the whole
          control — so the only way anyone discovers free flight is by being told it exists.
          ⚠️ TOP-CENTRE, not top-left: the fleet panel owns the left edge and the camera buttons own
          the bottom right. Placed left it sat underneath the panel and could not be read. */}
      {!flying && (
        <div
          data-testid="drone-hint"
          className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 select-none rounded-full bg-slate-950/70 px-3 py-1.5 text-[11px] font-medium text-white/70 ring-1 ring-white/10 backdrop-blur-md"
        >
          Drag to orbit · <span className="font-semibold text-white">Shift</span>/right-drag to pan
          · wheel to zoom · <span className="font-semibold text-white">W A S D</span> to fly
        </div>
      )}

      {/* Camera controls */}
      <div className="absolute bottom-16 right-4 z-20 flex select-none flex-col items-center gap-1.5">
        <button
          onClick={() => nudge(0, PITCH_STEP)}
          title="Tilt up (more top-down)"
          className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-900/70 text-lg leading-none text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-slate-800/90"
        >
          ▲
        </button>
        <div className="flex gap-1.5">
          <button
            onClick={() => nudge(-HEADING_STEP, 0)}
            title="Rotate left"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-900/70 text-lg leading-none text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-slate-800/90"
          >
            ◀
          </button>
          <button
            onClick={resetView}
            title="Reset view"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-900/70 text-base leading-none text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-slate-800/90"
          >
            ⌂
          </button>
          <button
            onClick={() => nudge(HEADING_STEP, 0)}
            title="Rotate right"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-900/70 text-lg leading-none text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-slate-800/90"
          >
            ▶
          </button>
        </div>
        <button
          onClick={() => nudge(0, -PITCH_STEP)}
          title="Tilt down (more horizontal)"
          className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-900/70 text-lg leading-none text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-slate-800/90"
        >
          ▼
        </button>
        <div className="mt-1 flex gap-1.5">
          <button
            onClick={() => doZoom(false)}
            title="Zoom out"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-900/70 text-xl leading-none text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-slate-800/90"
          >
            −
          </button>
          <button
            onClick={() => doZoom(true)}
            title="Zoom in"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-900/70 text-xl leading-none text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-slate-800/90"
          >
            +
          </button>
        </div>
        <button
          onClick={() => setAutoOrbit((o) => !o)}
          title="Toggle auto-orbit"
          className={`mt-1 flex h-9 items-center justify-center gap-1 rounded-md px-3 text-xs font-medium shadow-lg backdrop-blur-sm transition-colors ${
            autoOrbit ? 'bg-emerald-600/80 text-white hover:bg-emerald-600' : 'bg-slate-900/70 text-white hover:bg-slate-800/90'
          }`}
        >
          {autoOrbit ? '⏸ Orbit' : '⟳ Orbit'}
        </button>
        <select
          value={imagery}
          onChange={(e) => setImagery(e.target.value as ImageryMode)}
          title={modeInfo(imagery).hint}
          aria-label="Map imagery"
          data-testid="imagery-select"
          className={`mt-1 h-9 cursor-pointer rounded-md px-2 text-xs font-medium text-white shadow-lg backdrop-blur-sm transition-colors ${
            imagery === 'ion'
              ? 'bg-sky-600/80 hover:bg-sky-600'
              : imagery === 'nsw'
                ? 'bg-emerald-700/80 hover:bg-emerald-700'
                : 'bg-slate-900/70 hover:bg-slate-800/90'
          }`}
        >
          {AVAILABLE_MODES.map((m) => (
            <option key={m.id} value={m.id} title={m.hint} className="bg-slate-900 text-white">
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* ⚠️ Always visible, not behind Cesium's "Data attribution" link. The buildings and trees
          are OpenStreetMap under ODbL; share-alike attribution should not need a click to find.
          Photoreal mode is exempt — Cesium renders Google's and ion's own required logos there.
          ⚠️ BOTTOM RIGHT, not left: the Fleet panel owns the left edge and swallowed this whole
          line (the same trap the drone HUD fell into). It sits just under Cesium's own credit
          container, which main.css moves here for the same reason. */}
      {modeInfo(imagery).attribution && (
        <div
          data-testid="map-attribution"
          className="pointer-events-none absolute bottom-1 right-3 z-20 max-w-[58ch] select-none text-right text-[10px] leading-snug text-white/60 [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]"
        >
          {modeInfo(imagery).attribution}
        </div>
      )}

      {error && (
        <div className="absolute left-1/2 top-1/2 max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-slate-900/90 px-5 py-4 text-center text-sm text-white shadow-xl">
          {error}
        </div>
      )}
    </div>
  );
});
