/**
 * The Steinbachtalsperre corridor, in three dimensions.
 *
 * ⚠️ Read the header of `src/data/steinbach.ts` first. It sets five conditions this component
 * exists under, and the two that shape the code most are:
 *
 *   - the front position is interpolated from the three arrival times Hydrotec published, and
 *     nothing hydraulic is computed here;
 *   - **no depth is drawn**. The study gave a depth for two of the four places, so a water
 *     surface would have to invent the other two. What advances along the corridor is a front —
 *     a line reached or not reached — and the depths that exist are shown as text against the
 *     places they belong to.
 *
 * Its own renderer rather than the twin's. The valley scene carries a chainage model, a rating
 * curve and a connectivity mask, none of which apply to a corridor whose water comes from a
 * published table. Reusing it would have meant switching all of that off and hoping nothing
 * switched itself back on.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadBuildings } from '@/twin3d/buildings';
import { createFlyControls, type FlyControls } from '@/twin3d/flyControls';
import { loadVegetation } from '@/twin3d/vegetation';

import { useI18n } from '@/i18n';
import { HAZE_COLOUR } from '@/twin3d/haze';
import { buildDamBreakWseProfile } from '@/twin3d/steinbachDamBreak';
import {
  createHazardWseTexture,
  createWseTexture,
  loadTerrain,
} from '@/twin3d/terrainLoader';
import { createTerrainMaterial } from '@/twin3d/terrainMaterial';

import { DroneControl } from './DroneControl';
import {
  clockAt,
  CREST_M,
  FULL_SUPPLY_M,
  isOvertopping,
  reservoirLevelM,
  RESERVOIR_START_MINUTES,
} from '@/twin3d/steinbachReservoir';
import {
  CORRIDOR,
  CORRIDOR_LENGTH_KM,
  DAM,
  frontCelerityMs,
  frontHasReached,
  frontKmAt,
  publishedArrivalMinutes,
} from '@/twin3d/steinbachCorridor';

/** Longest the scenario runs, from the study's last published arrival. */
const MAX_MINUTES = 150;

export function SteinbachScene({ variant = 'panel' }: { variant?: 'panel' | 'full' } = {}) {
  const { t, locale } = useI18n();
  const full = variant === 'full';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<((km: number) => void) | null>(null);
  const reservoirRef = useRef<((minutes: number) => void) | null>(null);
  /** Push a new water-surface profile into the shader. Set once the scene is built. */
  const wseRef = useRef<((minutes: number) => void) | null>(null);
  // The outline loads asynchronously, so the effect needs the CURRENT slider value when it
  // arrives rather than the one captured when the scene was built.
  const minutesRef = useRef(0);
  const flyToRef = useRef<((target: 'dam' | 'end', immediate?: boolean) => void) | null>(null);
  /** Hand the camera to the viewer, or take it back. See `src/twin3d/flyControls.ts`. */
  const setFreeFlyRef = useRef<((on: boolean) => void) | null>(null);
  /**
   * Told when the camera engages or disengages free flight ON ITS OWN.
   *
   * ⚠️ The direction matters. With the old toggle React was the only thing that could change the
   * mode, so state flowed one way and a listener would have been redundant. `flyControls.ts`
   * merges the orbit map and the drone into a single control that engages itself from the input,
   * so the scene can enter free flight without React asking — and a button whose highlight is
   * driven only by clicks on itself would then be lying about the state of the camera.
   */
  const freeFlyChangedRef = useRef<((engaged: boolean) => void) | null>(null);
  const cruiseRef = useRef<(() => number) | null>(null);
  /** Show or hide the aerial photograph over the land cover. */
  const setDrapeRef = useRef<((on: boolean) => void) | null>(null);
  const [showDrape, setShowDrape] = useState(false);
  const [hasDrape, setHasDrape] = useState(false);
  const [freeFly, setFreeFly] = useState(false);
  const [minutes, setMinutes] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let frame = 0;
    let renderer: THREE.WebGLRenderer | null = null;

    loadTerrain('steinbach-2021', '/terrain', undefined, 'heightmap_2m')
      .then((assets) => {
        if (disposed) return;
        const meta = assets.terrain;
        const packed = assets.heightTexture.image.data as Uint16Array;

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(HAZE_COLOUR, 1);

        const scene = new THREE.Scene();
        // ⚠️ No THREE.Fog any more. The corridor used stock materials, so scene.fog did the
        // haze; it now runs the valley's GLSL3 terrain material, into which three.js injects no
        // fog chunks — the same reason haze.ts exists. The shader hazes itself, from the same
        // constants, and a fog object left here would only look like it was doing something.
        scene.background = new THREE.Color(HAZE_COLOUR);
        const widthM = meta.width * meta.resolutionM;
        const depthM = meta.height * meta.resolutionM;

        // ── terrain, water and land cover: one material ────────────────────
        //
        // This scene used to build its own mesh — vertex colours sampled from the land-use raster,
        // elevation written into the positions, MeshLambertMaterial — precisely because it did not
        // need water. Now that it models a dam break it needs exactly what the valley terrain
        // material already does: depth resolved per fragment from a water-surface profile indexed
        // by river chainage, land cover in the fragment shader, haze, and the hazard bands.
        // Keeping a second, simpler renderer alongside it would mean two things to keep in step.
        const wseTexture = createWseTexture(assets.flow.chainagePoints);
        // ⚠️ Left at zero, deliberately. The bands answer "how rare is the flood that first
        // reaches this ground", which needs return periods — HQ10/HQ100 — and those come from the
        // NRW flood-hazard maps, which are not wired up yet. An all-zero surface is below every
        // ground cell, so nothing is classified rather than everything being classified wrongly,
        // and uShowHazard stays 0 until there is a source to turn it on with.
        const hazardWseTexture = createHazardWseTexture(assets.flow.chainagePoints);

        const exaggeration = 1;
        const material = createTerrainMaterial({
          ...assets,
          wseTexture,
          hazardWseTexture,
          verticalExaggeration: exaggeration,
        });

        // A photograph lying flat on the ground is almost always seen at a grazing angle, which is
        // the case isotropic filtering smears worst.
        if (assets.drapeTexture) {
          assets.drapeTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
          assets.drapeTexture.needsUpdate = true;
        }
        setDrapeRef.current = (on: boolean) => {
          material.uniforms.uShowDrape.value = on ? 1 : 0;
        };
        setHasDrape(assets.drapeTexture !== null);

        // ⚠️ The mesh is coarser than the data, and that distinction is the whole fix here. This
        // used to build one vertex per heightmap cell: at 2 m over 5.0 x 6.3 km that is 2569 x
        // 3241 = 8.3 MILLION vertices, and the scene died with a shader validation failure
        // followed by repeated WebGL context loss. It rendered blank while the Ahr twin — eleven
        // times the area — rendered normally in the same browser seconds later, because the Ahr
        // has always built its mesh at width/4 and samples the full-resolution heightmap for the
        // elevations. Same trick here.
        //
        // Step 2 rather than the Ahr's 4: the AOI is at 2 m specifically because the dam crest is
        // about 5 m wide, and an 8 m mesh would resample the wall away — which would take the
        // reservoir's edge with it. 4 m keeps the wall and costs a quarter of the vertices.
        const MESH_STEP = 2;
        const segX = Math.max(1, Math.floor((meta.width - 1) / MESH_STEP));
        const segY = Math.max(1, Math.floor((meta.height - 1) / MESH_STEP));
        const geometry = new THREE.PlaneGeometry(widthM, depthM, segX, segY);
        geometry.rotateX(-Math.PI / 2);

        // Elevation is applied in the vertex shader from the height texture, in ABSOLUTE metres
        // above sea level — `uHeightMin + packed * uHeightScale`. That is the same datum the LoD2
        // buildings and the canopy are baked at, which is what stopped the forest floating.
        const terrain = new THREE.Mesh(geometry, material);
        // The plane is flat until the shader displaces it, so three.js computes a bounding sphere
        // for a sheet and culls the terrain the moment the camera drops below the ridge line.
        terrain.frustumCulled = false;
        scene.add(terrain);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8577, 2.2));
        const sun = new THREE.DirectionalLight(0xffffff, 1.1);
        sun.position.set(-1, 2, 1);
        scene.add(sun);

        // ── the real place ─────────────────────────────────────────────────
        // Cadastral buildings and measured canopy, from Geobasis NRW, through the same loaders
        // the Ahr uses — they were already AOI-parameterised, so this is a call rather than a
        // port. Both are optional: a corridor with bare ground still shows where the front got
        // to, and failing the whole scene because a 9 MB mesh did not arrive would be worse.
        // Vertical exaggeration is 1 here, so the heights they are placed at are the real ones.
        void loadBuildings('steinbach-2021', exaggeration)
          .then((layer) => {
            if (disposed) return;
            scene.add(layer.mesh);
            console.info(`LoD2: ${layer.meta.count} buildings`);
          })
          .catch(() => console.info('LoD2 buildings not available for the corridor'));

        void loadVegetation('steinbach-2021', exaggeration)
          .then((layer) => {
            if (disposed || !layer) return;
            // A Group rather than a Mesh: the trees are instanced in chunks so the renderer can
            // cull them, which is why this layer exposes `group` where buildings expose `mesh`.
            scene.add(layer.group);
            console.info(`vegetation: ${layer.drawn} trees in ${layer.chunks} chunks`);
          })
          .catch(() => console.info('vegetation not available for the corridor'));

        /** Lon/lat to scene metres, and the terrain height under that point. */
        const project = (lon: number, lat: number) => {
          const b = meta.boundsWgs84;
          const u = (lon - b.west) / (b.east - b.west);
          const v = (b.north - lat) / (b.north - b.south);
          const col = Math.min(meta.width - 1, Math.max(0, Math.round(u * meta.width)));
          const row = Math.min(meta.height - 1, Math.max(0, Math.round(v * meta.height)));
          const metres = meta.heightMinM + packed[row * meta.width + col] * meta.heightScale;
          return new THREE.Vector3(
            (u - 0.5) * widthM,
            metres * exaggeration,
            (v - 0.5) * depthM
          );
        };

        // ── the reservoir, which really did fill ───────────────────────────
        //
        // ⚠️ This is the one water surface in the whole Steinbach module, and it is here because
        // it is the half of that night that HAPPENED. The corridor front stays a line: the study
        // gave a depth for two places out of four, so a downstream surface would invent the other
        // two. The reservoir is different — the operator published the level it started at and
        // the level it reached.
        //
        // ⚠️ The outline is OpenStreetMap's mapped water body, not a contour of our terrain. A
        // first attempt flood-filled the heightmap from "the lowest cell near the dam" at crest
        // level and took 64 % of the map. Two reasons, both worth keeping: the `DAM` constant is
        // INSIDE the reservoir rather than on the wall, so the seed found the valley floor below
        // it — 17.7 m lower by construction — and crest level is by definition the level at which
        // a reservoir spills, so a fill at exactly that height escapes over the wall. That is not
        // a bug in the fill; it is what a crest is. A reservoir is a surveyed object, so ask for
        // its outline rather than infer one.
        //
        // The outline says WHERE the water is. The level says HOW HIGH. They come from different
        // sources and neither is allowed to imply the other.
        let reservoir: THREE.Mesh | null = null;
        void fetch('/terrain/steinbach-2021/reservoir.json')
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((data: { outline: [number, number][] }) => {
            if (disposed || !Array.isArray(data.outline) || data.outline.length < 3) return;
            // Flat in XZ, lifted as a whole to the water level. Building it in the XY plane and
            // rotating is how Three.js shapes work; the alternative is triangulating by hand.
            // ⚠️ The terrain plane is laid down with rotateX(-π/2), which maps shape-Y to world
            // -Z. Building this one with +π/2 mirrored the outline north-south: it drew a lake
            // in the wrong half of the valley, where a flat surface cut through hillsides and
            // came out as disconnected blue channels rather than water. It looked like a
            // z-fighting or drainage artefact, and it was a sign error. Negate Z here and rotate
            // the same way the ground does.
            const shape = new THREE.Shape(
              data.outline.map(([lon, lat]) => {
                const at = project(lon, lat);
                return new THREE.Vector2(at.x, -at.z);
              })
            );
            const geometry = new THREE.ShapeGeometry(shape);
            geometry.rotateX(-Math.PI / 2);
            reservoir = new THREE.Mesh(
              geometry,
              new THREE.MeshLambertMaterial({
                color: 0x2f6d90,
                transparent: true,
                opacity: 0.85,
                side: THREE.DoubleSide,
              })
            );
            reservoir.visible = false;
            scene.add(reservoir);
            // The slider may already have been moved while this was in flight.
            reservoirRef.current?.(minutesRef.current);
          })
          .catch(() => console.info('reservoir outline not available — no water surface drawn'));

        reservoirRef.current = (minutes: number) => {
          if (!reservoir) return;
          const level = reservoirLevelM(minutes);
          if (level === null) {
            reservoir.visible = false;
            return;
          }
          reservoir.visible = true;
          reservoir.position.y = level * exaggeration;
        };

        // ── the dam break itself ───────────────────────────────────────────
        //
        // One water-surface elevation per chainage point, handed to the shader as a 1D texture.
        // The shader resolves depth per fragment as `WSE[chainIndex(uv)] − terrainZ(uv)`, masked
        // by connectivity, which is why the water follows the real valley rather than a ribbon
        // drawn down the middle of it.
        const wseData = wseTexture.image.data as Float32Array;
        wseRef.current = (minutes: number) => {
          const profile = buildDamBreakWseProfile({
            minutes,
            bedProfileM: assets.flow.bedProfileM,
            ratingDischargeM3s: assets.flow.ratingDischargeM3s,
            ratingStageM: assets.flow.ratingStageM,
            // ⚠️ The dam, not the top of the line. Chainage 0 is 1.8 km upstream of the wall, in
            // the stream feeding the reservoir; releasing there would run the break down through
            // the reservoir it came out of.
            releaseIndex: assets.flow.release!.chainageIndex,
            chainageStepM: assets.flow.chainageStepM,
          });
          wseData.set(profile);
          wseTexture.needsUpdate = true;
        };
        wseRef.current(minutesRef.current);

        // ── the flow path, and the front that runs along it ────────────────
        const stops = [DAM, ...CORRIDOR];
        const pathPoints = stops.map((p) => {
          const at = project(p.lon, p.lat);
          at.y += 25; // clear of the surface so the line is not buried in it
          return at;
        });
        scene.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pathPoints),
            new THREE.LineBasicMaterial({ color: 0x7a8590 })
          )
        );

        // A front, not a flood: one marker showing how far the water has come. Deliberately not a
        // surface — see the note at the top of this file.
        //
        // ⚠️ These radii were 260 m and 170 m, sized for the old 7.6 x 16.5 km corridor where a
        // marker had to survive being seen from 20 km away. In a 5.0 x 6.3 km box they rendered as
        // white spheres half a kilometre across, sitting over the villages they were supposed to
        // point at.
        const front = new THREE.Mesh(
          new THREE.SphereGeometry(55, 20, 14),
          new THREE.MeshBasicMaterial({ color: 0x2e6f8e })
        );
        front.visible = false;
        scene.add(front);

        // Only the places this AOI actually covers get a marker. Palmersheim, Odendorf and
        // Heimerzheim are named in the readings and in the study's arrival times, but they are
        // outside the box by design — drawing a marker for them put spheres in empty sky beyond
        // the terrain edge, which reads as data rather than as absence.
        const inBox = (p: { lon: number; lat: number }) =>
          p.lon >= meta.boundsWgs84.west && p.lon <= meta.boundsWgs84.east &&
          p.lat >= meta.boundsWgs84.south && p.lat <= meta.boundsWgs84.north;

        const markers = CORRIDOR.filter(inBox).map((place) => {
          const at = project(place.lon, place.lat);
          const marker = new THREE.Mesh(
            new THREE.SphereGeometry(38, 16, 12),
            new THREE.MeshBasicMaterial({ color: 0xffffff })
          );
          marker.position.copy(at).setY(at.y + 45);
          scene.add(marker);
          return { place, marker };
        });

        /** Position along the path at a distance in km, for the front marker. */
        const alongPath = (km: number) => {
          const clamped = Math.min(Math.max(km, 0), CORRIDOR_LENGTH_KM);
          for (let i = 1; i < stops.length; i++) {
            const a = stops[i - 1];
            const b = stops[i];
            const aKm = 'kmFromDam' in a ? a.kmFromDam : 0;
            const bKm = 'kmFromDam' in b ? b.kmFromDam : 0;
            if (clamped <= bKm || i === stops.length - 1) {
              const span = bKm - aKm;
              const k = span > 0 ? (clamped - aKm) / span : 0;
              return new THREE.Vector3().lerpVectors(
                pathPoints[i - 1],
                pathPoints[i],
                Math.min(Math.max(k, 0), 1)
              );
            }
          }
          return pathPoints[0].clone();
        };

        frontRef.current = (km: number) => {
          front.visible = km > 0;
          if (km > 0) front.position.copy(alongPath(km));
          for (const { place, marker } of markers) {
            const reached = km >= place.kmFromDam;
            (marker.material as THREE.MeshBasicMaterial).color.set(
              reached ? 0x2e6f8e : 0xffffff
            );
          }
        };
        frontRef.current(0);

        // ── camera: down the corridor from behind the dam ──────────────────
        // The dam is at the southern end and Heimerzheim at the northern, so standing south of
        // the dam and looking north puts the whole route in front of the viewer in the order the
        // water would have taken it. An overhead three-quarter view, tried first, showed a flat
        // sheet with a line on it and no sense of travelling anywhere.
        //
        // That framing shipped as a FIXED camera — position set once, lookAt once, no controls at
        // all. It was a postcard: you could not pan along the corridor or get near the dam, which
        // is the one thing anyone wants to do here. OrbitControls now, with the same feel as the
        // Ahr twin so the two scenes handle alike.
        // ⚠️ Near 3 m, not the orbit camera's 20. At 20 m the drone cannot get closer than 20 m
        // to anything, so flying along the dam crest or down a street in Schweinheim clips
        // straight through the wall you came to look at. The cost is depth precision, paid for by
        // dropping far from 60 km to 18 km — the box is 6.3 km at its longest and the haze is
        // fully closed at 12 km, so nothing was ever drawn out there. `logarithmicDepthBuffer`
        // would be the other way to buy the range back, and is not available here: the buildings
        // and canopy are raw GLSL3 ShaderMaterials, so three.js injects no logdepth chunks into
        // them, exactly as it injects no fog chunks — which is why haze.ts exists.
        const camera = new THREE.PerspectiveCamera(42, 1, 3, 18_000);
        const damAt = project(DAM.lon, DAM.lat);
        // ⚠️ Frame the AOI, not the corridor. This used to look at the midpoint between the dam
        // and CORRIDOR's last entry — Heimerzheim, 15 km downstream and now well outside the box.
        // `project` clamps to the grid, so the target landed on the map edge and the camera sat
        // thousands of metres beyond it: the terrain rendered as a small wedge in the middle of
        // the frame. The centre of the heightmap is the honest subject of a scene whose box was
        // chosen around the reservoir and two villages.
        // ⚠️ Frame the SUBJECT, not the whole box. Two framings were tried and both were wrong for
        // the same underlying reason. Looking at the corridor's last entry aimed at Heimerzheim,
        // 15 km outside the box, so `project` clamped to the map edge and the terrain rendered as
        // a small wedge. Backing off to fit the entire heightmap then put all four cut edges in
        // frame at once, and no amount of haze can hide an edge that is close to the camera —
        // tightening the fog until the near edge softened only bleached the land use out of the
        // middle. The Ahr twin never has this problem because the camera sits inside the valley
        // and the map runs past the frustum on every side. Do the same here: sit low over the
        // reservoir and look along the dam-to-Schweinheim axis, so the edges fall outside the
        // frame instead of being argued with.
        const schweinheim = CORRIDOR.find((p) => p.id === 'schweinheim');
        const towards = schweinheim ? project(schweinheim.lon, schweinheim.lat) : new THREE.Vector3();
        const centre = new THREE.Vector3().lerpVectors(damAt, towards, 0.45);
        const axis = new THREE.Vector3().subVectors(towards, damAt);
        const axisM = Math.max(axis.length(), 1_200);
        // Behind the dam, looking down the axis the water would have taken.
        camera.position.set(
          damAt.x - axis.x * 0.55,
          damAt.y + axisM * 0.42,
          damAt.z - axis.z * 0.55
        );
        camera.lookAt(centre);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.screenSpacePanning = false;
        controls.zoomSpeed = 0.7;
        controls.rotateSpeed = 0.55;
        controls.minDistance = 200;
        // 40 km let the camera pull back until the terrain was a small tilted slab in the corner
        // of an empty frame — visible in the first demo recording. Then 18 km, sized to the old
        // 16.5 km corridor. The box is now 6.3 km at its longest, so anything much past twice
        // that is showing mostly haze.
        controls.maxDistance = 14_000;
        // Stop just short of the horizon, so the camera cannot drop below the terrain and look up
        // through it — the same guard the Ahr twin uses.
        controls.maxPolarAngle = Math.PI * 0.48;
        controls.target.copy(centre);
        controls.update();

        // Fly to a named point on the corridor. Same easing as the Ahr twin's bookmark flights, so
        // "take me to the dam" feels identical in both scenes. Distance-scaled duration: a hop to
        // the next village should not take as long as the full 16.5 km run.
        flyToRef.current = (target: 'dam' | 'end', immediate = false) => {
          // The wide view centres the map rather than retreating to look at a place outside it.
          // Aiming at Heimerzheim from 9 000 m put the valley in a corner of an empty frame, and
          // Heimerzheim is not even in this box any more.
          const focus = target === 'dam' ? damAt : centre;
          // Close enough to the dam to read the wall and the water behind it.
          const range = target === 'dam' ? 1_200 : axisM * 1.6;
          const toPos = new THREE.Vector3(focus.x + range * 0.3, focus.y + range * 0.75, focus.z + range);
          const fromPos = camera.position.clone();
          const fromTarget = controls.target.clone();
          if (immediate) {
            camera.position.copy(toPos);
            controls.target.copy(focus);
            controls.update();
            return;
          }
          const distance = Math.max(fromPos.distanceTo(toPos), fromTarget.distanceTo(focus));
          const duration = Math.min(2_600 + distance * 0.4, 7_000);
          const start = performance.now();
          const step = (now: number) => {
            const p = Math.min((now - start) / duration, 1);
            const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
            camera.position.lerpVectors(fromPos, toPos, eased);
            controls.target.lerpVectors(fromTarget, focus, eased);
            controls.update();
            if (p < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        };

        const resize = () => {
          const w = canvas.clientWidth || 1;
          const h = canvas.clientHeight || 1;
          renderer!.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        resize();
        window.addEventListener('resize', resize);

        // The drone, same one the Ahr twin flies. The orbit camera is good at looking at the
        // reservoir from outside and useless for standing on the dam crest, or in a street in
        // Schweinheim, and seeing how much wall is above your head.
        //
        // There is no toggle any more: W A S D takes the camera and letting go gives it back, and
        // the four contested inputs — drag, wheel, Shift, arrows — follow the latch. See
        // `flyControls.ts` for why that is one mode rather than two.
        const groundAt = (x: number, z: number): number | null => {
          const u = x / widthM + 0.5;
          const v = z / depthM + 0.5;
          if (u < 0 || u > 1 || v < 0 || v > 1) return null;
          // Same proportional mapping the mesh loop uses above: row 0 is north in both grids.
          const col = Math.min(meta.width - 1, Math.round(u * (meta.width - 1)));
          const row = Math.min(meta.height - 1, Math.round(v * (meta.height - 1)));
          // Absolute metres above sea level, and the terrain here is drawn at true scale, so this
          // is directly comparable with `camera.position.y`.
          return meta.heightMinM + packed[row * meta.width + col] * meta.heightScale;
        };

        const fly: FlyControls = createFlyControls({
          camera,
          domElement: renderer.domElement,
          controls,
          groundAt,
          onEngagedChange: (engaged) => freeFlyChangedRef.current?.(engaged),
        });
        cruiseRef.current = () => fly.cruiseMs;
        setFreeFlyRef.current = (on: boolean) => fly.setEngaged(on);

        let lastFrameMs = performance.now();
        const tick = () => {
          const now = performance.now();
          // Clamped: a backgrounded tab resumes with a delta of several seconds, and an
          // unclamped free-fly step would put the camera outside the AOI in one frame.
          const dt = Math.min((now - lastFrameMs) / 1000, 0.1);
          lastFrameMs = now;
          if (fly.engaged) {
            fly.update(dt);
          } else {
            controls.update();
          }
          // Where the camera is, as data — the same marker the Ahr twin exposes, because there is
          // no pixel test for "did the camera move".
          const p = camera.position;
          canvas.dataset.cam = `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`;
          // The water shader animates on uTime; without this the surface is glassy and still.
          material.uniforms.uTime.value = performance.now() / 1000;
          renderer!.render(scene, camera);
          frame = requestAnimationFrame(tick);
        };
        tick();
        canvas.dataset.sceneReady = 'true';
        setReady(true);

        return () => {
          window.removeEventListener('resize', resize);
          fly.dispose();
          controls.dispose();
        };
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      renderer?.dispose();
      frontRef.current = null;
      setFreeFlyRef.current = null;
      cruiseRef.current = null;
      wseRef.current = null;
      setDrapeRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Point the listener at the state setter for as long as this component is mounted. The scene
    // effect below runs once and captures the ref, not the setter, so the two need not agree on
    // ordering.
    freeFlyChangedRef.current = setFreeFly;
    return () => {
      freeFlyChangedRef.current = null;
    };
  }, []);

  useEffect(() => {
    minutesRef.current = minutes;
    frontRef.current?.(frontKmAt(minutes));
    reservoirRef.current?.(minutes);
    wseRef.current?.(minutes);
  }, [minutes]);

  const nf1 = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const celerity = frontCelerityMs(minutes);

  if (failed) {
    return (
      <p data-testid="steinbach-scene-error" className="mt-3 text-stone-500">
        {t('steinbach.sceneUnavailable')}
      </p>
    );
  }

  return (
    <div
      data-testid="steinbach-scene"
      data-variant={variant}
      // `full` makes this the map rather than a figure inside a panel: the canvas takes the height
      // and the readings sit beside it, the way the Ahr twin is laid out. `panel` is the original
      // 16 rem card, still used inside the companion-case dialog.
      className={full ? 'flex h-full w-full gap-4 p-4' : 'mt-4'}
    >
      <div
        className={
          full
            ? 'relative min-w-0 flex-1 overflow-hidden rounded border border-stone-300'
            : 'relative overflow-hidden rounded border border-stone-300'
        }
      >
        <canvas
          ref={canvasRef}
          data-testid="steinbach-scene-canvas"
          className={full ? 'block h-full w-full' : 'block h-64 w-full'}
        />
        {/* The badge is not decoration. It is the one thing that must be legible in a screenshot
            taken out of context, because everything under it is a model of an event that did not
            take place. */}
        {/*
          ⚠️ The badge changes with the sign of the clock, and that is the whole reason the two
          halves share a slider. Before 20:00 the viewer is watching the reservoir fill, which is
          documented and happened. From 20:00 they are watching a study's hypothetical. Badging
          the real hours as "did not happen" would be as wrong as badging the scenario as fact.
        */}
        <span
          data-testid="steinbach-scene-badge"
          data-phase={isOvertopping(minutes) ? 'scenario' : 'observed'}
          className={
            isOvertopping(minutes)
              ? 'pointer-events-none absolute left-2 top-2 rounded bg-amber-100/95 px-2 py-0.5 text-[0.65rem] font-semibold text-amber-900'
              : 'pointer-events-none absolute left-2 top-2 rounded bg-stone-200/95 px-2 py-0.5 text-[0.65rem] font-semibold text-stone-700'
          }
        >
          {isOvertopping(minutes) ? t('steinbach.didNotHappen') : t('steinbach.didHappen')}
        </span>

        {/* Top right, over the map, the way the Ahr twin and Campus-Insights both place it. The
            badge owns the top left, so the two never argue over the same corner. */}
        {ready && (
          <div className="absolute right-2 top-2 flex flex-col items-end gap-2">
            {hasDrape && (
              <button
                type="button"
                data-testid="steinbach-drape-toggle"
                aria-pressed={showDrape}
                aria-label={showDrape ? t('twin.hideDrape') : t('twin.showDrape')}
                onClick={() =>
                  setShowDrape((was) => {
                    setDrapeRef.current?.(!was);
                    return !was;
                  })
                }
                className={
                  showDrape
                    ? 'rounded border border-stone-700 bg-stone-700 px-2 py-1 text-[0.7rem] text-stone-50 shadow-sm'
                    : 'rounded border border-stone-300 bg-stone-50/92 px-2 py-1 text-[0.7rem] text-stone-600 shadow-sm backdrop-blur hover:bg-stone-200 hover:text-stone-900'
                }
              >
                {t('twin.drape')}
              </button>
            )}
            <DroneControl
              on={freeFly}
              testIdPrefix="steinbach"
              getCruiseMs={() => cruiseRef.current?.() ?? null}
            />
          </div>
        )}

        {!ready && (
          <span className="absolute inset-0 flex items-center justify-center text-[0.7rem] text-stone-500">
            {t('steinbach.sceneLoading')}
          </span>
        )}
      </div>

      {/* In `full` these readings become the side rail next to the map; in `panel` they simply
          continue down the card, which is why the wrapper is always present rather than conditional. */}
      <div className={full ? 'w-80 shrink-0 overflow-y-auto pr-1' : ''}>
      <label className="mt-3 block text-[0.7rem] text-stone-600" htmlFor="steinbach-scene-time">
        {/*
          The clock, not the offset. "Minus 143 Minuten" is the right unit for the scenario and a
          useless one for the evening the reservoir filled, which people remember by the hour.
        */}
        <span className="font-medium text-stone-900">{clockAt(minutes)}</span>{' '}
        {isOvertopping(minutes)
          ? t('steinbach.minutesAfterBreak', { minutes: String(minutes) })
          : t('steinbach.beforeOvertopping')}
        {celerity > 0 && (
          <span className="ml-2 text-stone-500">
            {t('steinbach.frontSpeed', { speed: nf1.format(celerity) })}
          </span>
        )}
      </label>

      {/*
        The two levels are quoted; the value between them never is. The interpolation moves the
        water and does not become a figure — the same rule the corridor front runs under.
      */}
      <p data-testid="steinbach-reservoir-level" className="mt-1 text-[0.7rem] text-stone-600">
        {isOvertopping(minutes)
          ? t('steinbach.atCrest', { crest: nf1.format(CREST_M) })
          : t('steinbach.filling', {
              full: nf1.format(FULL_SUPPLY_M),
              crest: nf1.format(CREST_M),
            })}
      </p>
      <input
        id="steinbach-scene-time"
        type="range"
        data-testid="steinbach-scene-time"
        min={RESERVOIR_START_MINUTES}
        max={MAX_MINUTES}
        step={1}
        value={minutes}
        onChange={(e) => setMinutes(Number(e.target.value))}
        className="mt-1 w-full accent-stone-700"
      />

      {/*
        The scene shipped with a fixed camera, so the one thing anyone wants to do here — get close
        to the dam — was impossible. Drag to orbit and scroll to zoom now work; these two put the
        camera somewhere useful without hunting for it.
      */}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="steinbach-fly-dam"
          onClick={() => {
            // A flight and the drone both own the camera, and would fight over it frame by frame.
            setFreeFly(false);
            setFreeFlyRef.current?.(false);
            flyToRef.current?.('dam');
          }}
          className="rounded border border-stone-300 bg-stone-50 px-2 py-1 text-[0.7rem] text-stone-600 hover:bg-stone-200 hover:text-stone-900"
        >
          {t('steinbach.flyToDam')}
        </button>
        <button
          type="button"
          data-testid="steinbach-fly-corridor"
          onClick={() => {
            setFreeFly(false);
            setFreeFlyRef.current?.(false);
            flyToRef.current?.('end');
          }}
          className="rounded border border-stone-300 bg-stone-50 px-2 py-1 text-[0.7rem] text-stone-600 hover:bg-stone-200 hover:text-stone-900"
        >
          {t('steinbach.flyToCorridor')}
        </button>
      </div>

      <ul className="mt-2 space-y-0.5 text-[0.7rem]">
        {CORRIDOR.map((place) => {
          const arrival = publishedArrivalMinutes(place.id);
          const reached = frontHasReached(place.id, minutes);
          return (
            <li
              key={place.id}
              data-testid={`steinbach-scene-place-${place.id}`}
              // Whether the front has passed a place is asserted in e2e, so it is stated as data
              // rather than left to be inferred from a colour class.
              data-reached={reached ? 'true' : 'false'}
              className={reached ? 'text-stone-900' : 'text-stone-400'}
            >
              <span className="font-medium">{t(`steinbach.places.${place.id}`)}</span>{' '}
              <span className="text-stone-500">
                {arrival === undefined
                  ? t('steinbach.notPublished')
                  : t('steinbach.minutes', { minutes: String(arrival) })}
              </span>
            </li>
          );
        })}
      </ul>

      {/* The study's finding sits in the same view as its worst case, not on a later screen. */}
      <p className="mt-3 border-t border-stone-200 pt-2 text-[0.7rem] text-stone-600">
        {t('steinbach.studyConclusion')}
      </p>
      <p className="mt-1 text-[0.65rem] text-stone-400">{t('steinbach.sceneTerrainNote')}</p>
      </div>
    </div>
  );
}
