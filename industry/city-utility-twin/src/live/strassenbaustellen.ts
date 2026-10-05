import * as THREE from 'three';

import type { LiveLayer, PickDetail, WorldPlacement } from '../map/worldScene';
import { failure, fetchJson, type StatusReporter } from './source';
import { clipPolylineToBox } from './clip.mjs';
import { later, locale, t, type MessageKey, type Text } from '../i18n';

/**
 * Roadworks published by Hamburg and by Baden-Württemberg, one module for both feeds.
 *
 * ⚠️ TWO DIFFERENT STATEMENTS, AND THE LAYER NAMES SAY WHICH. Hamburg's "Baustellen Hamburg" (LGV,
 * from the Bauweiser platform) is the city's own register of roadworks profiles, points with a
 * title, the body carrying out the work and dates. The Baden-Württemberg feed (Verkehrsministerium,
 * via MobiData BW) covers federal, state and district roads ONLY, no municipal streets; measured
 * on 2026-10-05, none of its 903 entries lay inside the Kessel core. The row and the panel say
 * "keine Gemeindestraßen" so an empty core is not read as "no works".
 *
 * ⚠️ WHAT THESE LAYERS MUST NOT BE READ AS. A symbol is a published notification with dates. It is
 * not a statement about who is digging, what is underneath, or whether work runs to plan.
 *
 * ⚠️ THE WHOLE MODELLED AREA, NOT JUST THE CORE. Both feeds are small (about 0.35 and 1 MB), so
 * everything that falls on the terrain, core and surrounding shell, is drawn; the rest is counted.
 */

export type RoadworksSourceId = 'baustellen-hamburg' | 'baustellen-bw';

interface Feature {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
}
interface FeatureCollection { features?: Feature[] }

interface Record_ {
  title: Text;
  subtitle?: Text;
  fields: { label: Text; value: Text }[];
}

interface RoadworksSource {
  url: string;
  nameKey: MessageKey;
  sourceKey: MessageKey;
  record(properties: Record<string, unknown>): Record_;
}

/** Verbatim text, trimmed, or null for an empty or non-text value. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/** An ISO timestamp as a local date; anything unparseable is shown as published. */
function day(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const at = Date.parse(raw);
  return Number.isFinite(at)
    ? new Date(at).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' })
    : raw;
}

function period(fields: Record_['fields'], from: string | null, to: string | null) {
  if (from && to) fields.push({ label: later('field.period'), value: later('field.periodValue', from, to) });
  else if (from) fields.push({ label: later('field.start'), value: from });
  else if (to) fields.push({ label: later('field.end'), value: to });
}

function add(fields: Record_['fields'], label: MessageKey, value: string | null) {
  if (value) fields.push({ label: later(label), value });
}

const SOURCES: Record<RoadworksSourceId, RoadworksSource> = {
  'baustellen-hamburg': {
    // WFS "Baustellen Hamburg", LGV, dl-de/by-2-0. CORS open (measured 2026-10-05).
    url: 'https://geodienste.hamburg.de/hh_wfs_baustellen?SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature'
      + '&typename=de.hh.up:baustelle&outputFormat=application/geo%2Bjson&srsName=EPSG:4326',
    nameKey: 'layer.baustellen-hamburg.name',
    sourceKey: 'roadworks.source.hamburg',
    record(p) {
      const fields: Record_['fields'] = [];
      // Dates arrive as dd.mm.yyyy and are shown as published.
      period(fields, text(p.baubeginn), text(p.bauende));
      add(fields, 'field.organisation', text(p.organisation));
      add(fields, 'field.reason', text(p.anlass));
      add(fields, 'field.impact', text(p.umfang));
      add(fields, 'field.updated', day(p.letzteaktualisierung));
      return { title: text(p.titel) ?? later('roadworks.noPlace'), fields };
    },
  },
  'baustellen-bw': {
    // MobiData BW "Baustelleninformationen Baden-Württemberg", Verkehrsministerium BW, dl-de/by-2-0.
    url: 'https://api.mobidata-bw.de/datasets/traffic/roadworks/roadworks_geojson.json',
    nameKey: 'layer.baustellen-bw.name',
    sourceKey: 'roadworks.source.bw',
    record(p) {
      const fields: Record_['fields'] = [];
      period(fields, day(p.starttime), day(p.endtime));
      add(fields, 'field.street', text(p.street));
      // The feed's own codes (CONSTRUCTION, ROAD_CLOSED_CONSTRUCTION, ...), shown as published.
      add(fields, 'field.kind', [text(p.type), text(p.subtype)].filter(Boolean).join(' · ') || null);
      add(fields, 'field.direction', text(p.direction));
      return { title: text(p.description) ?? text(p.street) ?? later('roadworks.noPlace'), subtitle: text(p.street) ?? undefined, fields };
    },
  },
};

export function roadworksSource(id: RoadworksSourceId): { nameKey: MessageKey; sourceKey: MessageKey } {
  return { nameKey: SOURCES[id].nameKey, sourceKey: SOURCES[id].sourceKey };
}

type Position = [number, number];

/** Every [lon, lat] path in a geometry: one per line, one single-point path per point. */
function pathsOf(geometry: Feature['geometry']): Position[][] {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const c = geometry.coordinates as unknown[];
  const ok = (p: unknown): p is Position =>
    Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  switch (geometry.type) {
    case 'Point': return ok(c) ? [[c as unknown as Position]] : [];
    case 'MultiPoint': return (c as unknown[]).filter(ok).map((p) => [p]);
    case 'LineString': return [(c as unknown[]).filter(ok)];
    case 'MultiLineString': return (c as unknown[][]).map((line) => (Array.isArray(line) ? line.filter(ok) : []));
    default: return [];
  }
}

/** Amber, the convention on every German roadworks sign. */
const COLOUR = 0xf08a24;
/** A marker is a map symbol, not the site's footprint: the feeds publish a point or a road axis. */
const MARKER_RADIUS_M = 18;
const MARKER_HEIGHT_M = 2;
/** Metres above the terrain, so a line clears the drape without floating visibly. */
const LINE_LIFT_M = 2;

export interface RoadworksOptions {
  placement: WorldPlacement;
  onStatus: StatusReporter;
  source: RoadworksSourceId;
  /** Overrides for tests. */
  url?: string;
}

export async function createRoadworksLayer(options: RoadworksOptions): Promise<LiveLayer> {
  const { placement, onStatus } = options;
  const source = SOURCES[options.source];
  const url = options.url ?? source.url;

  const group = new THREE.Group();
  group.name = options.source;
  group.visible = false;
  placement.group.add(group);

  const abort = new AbortController();
  const owned: (THREE.BufferGeometry | THREE.Material)[] = [];
  let visible = false;
  let pending: Promise<void> | null = null;
  let lastStatus: { text: Text; at: Date; count: number } | null = null;

  const markerGeometry = new THREE.CylinderGeometry(MARKER_RADIUS_M, MARKER_RADIUS_M, MARKER_HEIGHT_M, 20);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: COLOUR, transparent: true, opacity: 0.85, depthWrite: false });
  const lineMaterial = new THREE.LineBasicMaterial({ color: COLOUR });
  const highlight = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false });
  owned.push(markerGeometry, markerMaterial, lineMaterial, highlight);
  let highlighted: THREE.Mesh[] = [];

  const [minX, minZ, maxX, maxZ] = placement.worldBoundsM;
  const onMap = (v: THREE.Vector3) => v.x >= minX && v.x <= maxX && v.z >= minZ && v.z <= maxZ;
  // The clipper works in any planar pair; here it is world x and z.
  const box = { minE: minX, minN: minZ, maxE: maxX, maxN: maxZ };

  const build = (features: Feature[]) => {
    let drawn = 0;
    let offMap = 0;
    for (const feature of features) {
      const paths = pathsOf(feature.geometry).filter((path) => path.length > 0);
      if (!paths.length) continue;
      // ⚠️ CLIPPED, NOT VERTEX-TESTED. A road axis can cross the whole model with both ends outside,
      // and a long one can run far beyond it; testing vertices would drop the first and draw the
      // second out over terrain that does not exist.
      const points: THREE.Vector3[] = [];
      const runs: THREE.Vector3[][] = [];
      for (const path of paths) {
        const world = path.map(([lon, lat]) => placement.toWorld(lat, lon));
        if (world.length === 1) {
          if (onMap(world[0])) points.push(world[0]);
          continue;
        }
        for (const run of clipPolylineToBox(world.map((v) => [v.x, v.z] as [number, number]), box)) {
          runs.push(run.map(([x, z]) => new THREE.Vector3(x, placement.groundAt(x, z) ?? world[0].y, z)));
        }
      }
      if (!points.length && !runs.length) { offMap++; continue; }

      const rec = source.record(feature.properties ?? {});
      const detail: PickDetail = {
        layerId: options.source,
        title: rec.title,
        subtitle: rec.subtitle,
        accent: COLOUR,
        fields: rec.fields,
        source: later(source.sourceKey),
      };
      for (const line of runs) {
        if (line.length < 2) continue;
        const geometry = new THREE.BufferGeometry().setFromPoints(
          line.map((v) => new THREE.Vector3(v.x, v.y + LINE_LIFT_M, v.z)),
        );
        owned.push(geometry);
        const drawnLine = new THREE.Line(geometry, lineMaterial);
        drawnLine.renderOrder = 2;
        group.add(drawnLine);
      }
      // One clickable marker per notification, on its point or the middle of its first clipped
      // run. Lines are hard to hit with a pointer; the marker carries the detail.
      const anchor = points[0] ?? runs[0][Math.floor(runs[0].length / 2)];
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.set(anchor.x, anchor.y + MARKER_HEIGHT_M / 2 + 0.5, anchor.z);
      marker.renderOrder = 2;
      marker.userData.pick = detail;
      group.add(marker);
      drawn++;
    }
    placement.invalidate();
    return { drawn, offMap };
  };

  const load = async () => {
    if (lastStatus) {
      onStatus({ state: 'live', text: lastStatus.text, fetchedAt: lastStatus.at, count: lastStatus.count });
      return;
    }
    if (pending) return pending;
    onStatus({ state: 'loading', text: later('roadworks.loading'), fetchedAt: null, count: 0 });
    pending = (async () => {
      try {
        const data = await fetchJson<FeatureCollection>(url, { signal: abort.signal, timeoutMs: 30000 });
        if (abort.signal.aborted) return;
        const features = Array.isArray(data.features) ? data.features : [];
        const { drawn, offMap } = build(features);
        const at = new Date();
        const statusText = () => {
          const parts = [drawn === 0 ? t('status.noFeatures') : t('roadworks.sites', drawn)];
          if (offMap > 0) parts.push(t('status.offMap', offMap));
          if (options.source === 'baustellen-bw') parts.push(t('roadworks.classifiedOnly'));
          return parts.join(' · ');
        };
        lastStatus = { text: statusText, at, count: drawn };
        if (visible) onStatus({ state: 'live', text: statusText, fetchedAt: at, count: drawn });
      } catch (error) {
        if (abort.signal.aborted) return;
        if (visible) onStatus({ state: 'error', text: failure(later(source.nameKey), error), fetchedAt: null, count: 0 });
      } finally {
        pending = null;
      }
    })();
    return pending;
  };

  return {
    id: options.source,
    setVisible(next) {
      visible = next;
      group.visible = next;
      if (next) void load();
      else onStatus({ state: 'idle', text: later('layer.off'), fetchedAt: null, count: 0 });
      placement.invalidate();
    },
    onPicked(detail) {
      for (const mesh of highlighted) mesh.material = markerMaterial;
      highlighted = [];
      if (!detail || detail.layerId !== options.source) return;
      for (const child of group.children) {
        if (child instanceof THREE.Mesh && child.userData.pick === detail) {
          child.material = highlight;
          highlighted.push(child);
        }
      }
      placement.invalidate();
    },
    dispose() {
      abort.abort();
      group.clear();
      for (const item of owned) item.dispose();
      placement.group.remove(group);
    },
  };
}
