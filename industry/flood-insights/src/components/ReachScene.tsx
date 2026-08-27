import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { useI18n } from '@/i18n';
import { createFlyControls, type FlyControls } from '@/twin3d/flyControls';
import { HAZE_COLOUR } from '@/twin3d/haze';
import { buildSteadyWseProfile } from '@/twin3d/hydrograph';
import {
  createHazardWseTexture,
  createWseTexture,
  loadTerrain,
  type TerrainAssets,
} from '@/twin3d/terrainLoader';
import { createTerrainMaterial } from '@/twin3d/terrainMaterial';

import { DroneControl } from './DroneControl';

/**
 * A reach, shown at a steady discharge — the third kind of scene.
 *
 * ⚠️ THIS DELIBERATELY HAS NO CLOCK, and that is the whole design.
 *
 * The Ahr has a gauge series and the Steinbach corridor has a published dam-break study, so both
 * can answer "where was the water at 03:00". Horta Sud and Castel Bolognese can answer no such
 * question, because neither event's gauge record is publicly retrievable: ARPAE Emilia-Romagna's
 * open API serves a rolling 63-hour window and ignores every date parameter offered to it, and no
 * open historical endpoint was found for the Júcar's SAIH. Their own AOI configs already say the
 * peak time is "a modelling assumption ... until a gauge series is ingested".
 *
 * Giving these two a timeline would mean inventing the hydrograph the configs warn about. So the
 * control is a DISCHARGE instead of a time: the scene answers "where would a flow of Q stand",
 * which is a question the terrain and the Manning rating can answer honestly on their own, and it
 * claims nothing whatsoever about 2023 or 2024.
 */
export function ReachScene({
  aoiId,
  terrainName,
  flowName,
}: {
  aoiId: string;
  /** Per AOI: Horta Sud is built at 5 m, Castel Bolognese at 20 m. */
  terrainName: string;
  /** Per AOI too — the builder refuses a flow field finer than its terrain. */
  flowName: string;
}) {
  const { t, locale } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dischargeRef = useRef<((q: number) => void) | null>(null);
  const cruiseRef = useRef<(() => number) | null>(null);
  /**
   * The merged camera engages free flight from the input itself, so React is TOLD rather than
   * telling — see flyControls.ts. Without this the indicator would sit idle while the camera flew.
   */
  const freeFlyChangedRef = useRef<((engaged: boolean) => void) | null>(null);
  const setDrapeRef = useRef<((on: boolean) => void) | null>(null);

  const [levels, setLevels] = useState<number[]>([]);
  const [discharge, setDischarge] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [freeFly, setFreeFly] = useState(false);
  const [showDrape, setShowDrape] = useState(false);
  const [hasDrape, setHasDrape] = useState(false);

  useEffect(() => {
    freeFlyChangedRef.current = setFreeFly;
    return () => {
      freeFlyChangedRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let frame = 0;
    let renderer: THREE.WebGLRenderer | null = null;

    loadTerrain(aoiId, '/terrain', undefined, terrainName, flowName)
      .then((assets: TerrainAssets) => {
        if (disposed) return;
        const meta = assets.terrain;
        const packed = assets.heightTexture.image.data as Uint16Array;

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(HAZE_COLOUR, 1);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(HAZE_COLOUR);
        const widthM = meta.width * meta.resolutionM;
        const depthM = meta.height * meta.resolutionM;

        const wseTexture = createWseTexture(assets.flow.chainagePoints);
        // Left at zero: hazard classes need return periods, and neither of these AOIs has a
        // frequency curve. Nothing is classified rather than everything classified wrongly.
        const hazardWseTexture = createHazardWseTexture(assets.flow.chainagePoints);
        const material = createTerrainMaterial({
          ...assets,
          wseTexture,
          hazardWseTexture,
          verticalExaggeration: 1,
        });
        if (assets.drapeTexture) {
          assets.drapeTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
          assets.drapeTexture.needsUpdate = true;
        }
        setDrapeRef.current = (on: boolean) => {
          material.uniforms.uShowDrape.value = on ? 1 : 0;
        };
        setHasDrape(assets.drapeTexture !== null);

        // The mesh is coarser than the data; the vertex shader displaces it from the full
        // heightmap. Quarter resolution is what the Ahr uses and what keeps the vertex count sane.
        const segX = Math.max(1, Math.floor(meta.width / 4));
        const segY = Math.max(1, Math.floor(meta.height / 4));
        const geometry = new THREE.PlaneGeometry(widthM, depthM, segX, segY);
        geometry.rotateX(-Math.PI / 2);
        const terrain = new THREE.Mesh(geometry, material);
        // Flat until the shader displaces it, so the bounding sphere is a sheet and the ground
        // would be culled the moment the camera dropped below the ridge line.
        terrain.frustumCulled = false;
        scene.add(terrain);

        scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8577, 2.0));
        const sun = new THREE.DirectionalLight(0xffffff, 1.0);
        sun.position.set(-1, 2, 1);
        scene.add(sun);

        // ── the water, at whatever steady discharge is asked for ───────────
        const wseData = wseTexture.image.data as Float32Array;
        const ratingLevels = assets.flow.ratingDischargeM3s;
        dischargeRef.current = (q: number) => {
          const profile = buildSteadyWseProfile({
            gaugeDischargeM3s: q,
            bedProfileM: assets.flow.bedProfileM,
            ratingDischargeM3s: assets.flow.ratingDischargeM3s,
            ratingStageM: assets.flow.ratingStageM,
          });
          wseData.set(profile);
          wseTexture.needsUpdate = true;
        };
        setLevels(ratingLevels);

        // Frame the river rather than the box: these AOIs are wide and mostly plain, so fitting
        // the whole rectangle would put the reach in the middle distance.
        const c = assets.flow.riverCentroid;
        const focus = new THREE.Vector3((c.u - 0.5) * widthM, 0, (c.v - 0.5) * depthM);
        const row = Math.min(meta.height - 1, Math.max(0, Math.round(c.v * meta.height)));
        const col = Math.min(meta.width - 1, Math.max(0, Math.round(c.u * meta.width)));
        focus.y = meta.heightMinM + packed[row * meta.width + col] * meta.heightScale;

        const span = Math.max(widthM * (c.uMax - c.uMin), depthM * (c.vMax - c.vMin));

        // Open close enough that the ground reads. Distance proportional to the reach is right for
        // a valley, where the relief carries the picture at any distance, and wrong for a plain,
        // where it does not: the Poyo runs 24 km across the Valencian plain, and framing all of it
        // put the camera 13 km up over ground with 300 m of relief in the far corner and none at
        // all where the flood was. It rendered a featureless grey slab — correct, and useless.
        // Beyond roughly 12 km the land cover and the orthophoto stop resolving, so cap the
        // opening distance there and let the user pull back if they want the whole reach.
        const framing = Math.min(span, 12_000);
        const camera = new THREE.PerspectiveCamera(45, 1, 3, Math.max(40_000, span * 4));
        camera.position.set(
          focus.x - framing * 0.35,
          focus.y + framing * 0.55,
          focus.z + framing * 0.75
        );
        camera.lookAt(focus);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.zoomSpeed = 0.7;
        controls.rotateSpeed = 0.55;
        controls.minDistance = 200;
        controls.maxDistance = Math.max(30_000, span * 3);
        controls.maxPolarAngle = Math.PI * 0.48;
        controls.target.copy(focus);
        controls.update();

        const groundAt = (x: number, z: number): number | null => {
          const u = x / widthM + 0.5;
          const v = z / depthM + 0.5;
          if (u < 0 || u > 1 || v < 0 || v > 1) return null;
          const gc = Math.min(meta.width - 1, Math.max(0, Math.round(u * meta.width)));
          const gr = Math.min(meta.height - 1, Math.max(0, Math.round(v * meta.height)));
          return meta.heightMinM + packed[gr * meta.width + gc] * meta.heightScale;
        };

        const fly: FlyControls = createFlyControls({
          camera,
          domElement: renderer.domElement,
          controls,
          groundAt,
          onEngagedChange: (engaged) => freeFlyChangedRef.current?.(engaged),
        });
        cruiseRef.current = () => fly.cruiseMs;

        const resize = () => {
          const w = canvas.clientWidth || 1;
          const h = canvas.clientHeight || 1;
          renderer!.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        resize();
        window.addEventListener('resize', resize);

        let lastFrameMs = performance.now();
        const tick = () => {
          const now = performance.now();
          const dt = Math.min((now - lastFrameMs) / 1000, 0.1);
          lastFrameMs = now;
          fly.update(dt);
          material.uniforms.uTime.value = now / 1000;
          const p = camera.position;
          canvas.dataset.cam = `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`;
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
      dischargeRef.current = null;
      cruiseRef.current = null;
      setDrapeRef.current = null;
    };
  }, [aoiId, terrainName, flowName]);

  // Start at the middle of the rating's own range once it is known, so the first frame shows water
  // rather than a dry bed the viewer has to go looking for.
  useEffect(() => {
    if (levels.length && discharge === 0) setDischarge(levels[Math.floor(levels.length / 2)]);
  }, [levels, discharge]);

  useEffect(() => {
    if (discharge > 0) dischargeRef.current?.(discharge);
  }, [discharge]);

  const nf = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB');
  const min = levels.length ? levels[0] : 0;
  const max = levels.length ? levels[levels.length - 1] : 0;

  if (failed) {
    return (
      <p data-testid="reach-scene-error" className="mt-3 text-stone-500">
        {t('reach.unavailable')}
      </p>
    );
  }

  return (
    <div data-testid="reach-scene" className="flex h-full w-full gap-4 p-4">
      <div className="relative min-w-0 flex-1 overflow-hidden rounded border border-stone-300">
        <canvas
          ref={canvasRef}
          data-testid="reach-scene-canvas"
          className="block h-full w-full"
        />
        {/* The badge is not decoration: this surface is a steady state that never occurred, and a
            screenshot taken out of context has to carry that with it. */}
        <span
          data-testid="reach-scene-badge"
          className="pointer-events-none absolute left-2 top-2 rounded bg-amber-100/95 px-2 py-0.5 text-[0.65rem] font-semibold text-amber-900"
        >
          {t('reach.badge')}
        </span>
        {ready && (
          <div className="absolute right-2 top-2 flex flex-col items-end gap-2">
            {hasDrape && (
              <button
                type="button"
                data-testid="reach-drape-toggle"
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
              testIdPrefix="reach"
              getCruiseMs={() => cruiseRef.current?.() ?? null}
            />
          </div>
        )}
        {!ready && (
          <span className="absolute inset-0 flex items-center justify-center text-[0.7rem] text-stone-500">
            {t('reach.loading')}
          </span>
        )}
      </div>

      <div className="w-80 shrink-0 overflow-y-auto pr-1">
        <label className="block text-[0.7rem] text-stone-600" htmlFor="reach-discharge">
          <span className="font-medium text-stone-900" data-testid="reach-discharge-value">
            {nf.format(discharge)} m³/s
          </span>{' '}
          {t('reach.dischargeLabel')}
        </label>
        <input
          id="reach-discharge"
          type="range"
          data-testid="reach-discharge"
          min={min}
          max={max}
          step={1}
          value={discharge}
          onChange={(e) => setDischarge(Number(e.target.value))}
          className="mt-1 w-full accent-stone-700"
          disabled={!levels.length}
        />

        {/*
          ⚠️ The caption carries the one thing that separates this scene from the other two: there
          is no clock here because there is no gauge record, and the surface is a steady state
          rather than a moment of the flood.
        */}
        <p data-testid="reach-scene-note" className="mt-3 text-[0.7rem] leading-relaxed text-stone-500">
          {t('reach.note')}
        </p>
      </div>
    </div>
  );
}
