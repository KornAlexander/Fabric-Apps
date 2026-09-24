import * as THREE from 'three';

import type { LiveLayer, PickDetail, WorldPlacement } from '../map/worldScene';
import { clock, describeError, fetchJson, type StatusReporter } from './source';
import { clipPolylineToBox } from './clip.mjs';
import type { WfsLayerSpec } from './wfsCatalogue';

/**
 * One WFS layer engine for every open dataset of the Landeshauptstadt.
 *
 * ⚠️ WHY THIS IS GENERIC AND `baustellen.ts` IS NOT. The Baustellen layer carries the
 * coordination note workflow: it owns feature identity, note anchoring and highlight-on-pick, and
 * its status line summarises two `art` values by name. That is genuine domain behaviour and it
 * stays hand-written. Everything the OTHER 60 usable datasets need is the same three operations
 * repeated: ask a GeoServer for one bounding box, turn EPSG:25832 geometry into draped meshes,
 * and list the properties in the detail panel. Written once per dataset that would be 60 near
 * identical files and 60 chances to mistype an endpoint.
 *
 * ⚠️ THE ENDPOINT IS PER LAYER, NOT A CONSTANT. Measured on 2026-09-22 while inventorying the
 * portal: the city spreads its layers over at least seven GeoServer workspaces (`mor_wfs`,
 * `rku_wfs`, `gsm_wfs`, `soz_wfs`, `baug_wfs`, `baut_wfs`, `kvr_wfs`). Asking the mobility
 * workspace for a waste layer returns a `ServiceException` that looks exactly like a retired
 * layer, which is how a first inventory pass wrongly declared 32 live datasets dead.
 *
 * ⚠️ POINT MARKERS ARE SYMBOLS, NOT SCALE MODELS. A charging post is about 1.5 m tall; at 1:1 it
 * is sub-pixel from any useful camera height, so points are drawn as map pins at a fixed symbolic
 * size, exactly as the MVG layer already does for stops. This is not terrain or object
 * exaggeration: nothing here claims to be a model of the physical object, and the panel says so.
 *
 * ⚠️ A LINE'S WIDTH IS A CLAIM ABOUT THE WORLD, SO IT COMES FROM THE DATA WHERE THE DATA HAS IT.
 * The tactile guidance layer shipped at a hard-coded 0.9 m while the city publishes `breite_cm`
 * of 50 for 30 of its 32 features: an 80 % exaggeration presented in a comment as "the real
 * width". Specs that name a `widthField` now read it per feature; the rest use a declared
 * cartographic width and must not be described as measured.
 */

/** Metres above the terrain, matching the Baustellen drape so layers do not z-fight. */
const DRAPE_OFFSET_M = 1.2;

/** Symbolic pin dimensions. See the note above: these are marker sizes, not object sizes. */
const PIN_HEIGHT_M = 45;
const PIN_RADIUS_M = 2.2;
const PIN_HEAD_M = 5;

/** Properties that carry no meaning for a reader, so they never reach the detail panel. */
const HIDDEN_KEYS = /^(id|fid|gid|objectid|geom|the_geom|shape|bbox)$/i;

interface Feature {
  id?: string;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
}
interface FeatureCollection { features?: Feature[] }

type Position = [number, number];

function isPosition(value: unknown): value is Position {
  return Array.isArray(value) && value.length >= 2
    && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

/** Every point of a Point or MultiPoint geometry. */
function pointsOf(geometry: Feature['geometry']): Position[] {
  if (!geometry) return [];
  const coordinates = geometry.coordinates;
  if (geometry.type === 'Point') return isPosition(coordinates) ? [coordinates] : [];
  if (geometry.type === 'MultiPoint') {
    return Array.isArray(coordinates) ? coordinates.filter(isPosition) : [];
  }
  return [];
}

/** Every line of a LineString or MultiLineString geometry. */
function linesOf(geometry: Feature['geometry']): Position[][] {
  if (!geometry) return [];
  const coordinates = geometry.coordinates;
  if (geometry.type === 'LineString') {
    return Array.isArray(coordinates) ? [coordinates.filter(isPosition)] : [];
  }
  if (geometry.type === 'MultiLineString') {
    return Array.isArray(coordinates)
      ? (coordinates as unknown[])
        .map((line) => (Array.isArray(line) ? line.filter(isPosition) : []))
        .filter((line) => line.length >= 2)
      : [];
  }
  return [];
}

/** Polygon and MultiPolygon, flattened to outer rings with their holes. */
function ringsOf(geometry: Feature['geometry']): { outer: Position[]; holes: Position[][] }[] {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const polygons: Position[][][] =
    geometry.type === 'MultiPolygon'
      ? (geometry.coordinates as Position[][][])
      : geometry.type === 'Polygon'
        ? [geometry.coordinates as Position[][]]
        : [];
  const result: { outer: Position[]; holes: Position[][] }[] = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) continue;
    const [outer, ...holes] = polygon;
    if (!Array.isArray(outer) || outer.length < 4) continue;
    result.push({
      outer: outer.filter(isPosition),
      holes: holes.filter((hole) => Array.isArray(hole) && hole.length >= 4)
        .map((hole) => hole.filter(isPosition)),
    });
  }
  return result.filter((entry) => entry.outer.length >= 4);
}

/** `beginn_datum` becomes `Beginn datum`. Crude, but honest about being the publisher's key. */
function prettyKey(key: string): string {
  const text = key.replace(/_/g, ' ').trim();
  return text.length ? text.charAt(0).toUpperCase() + text.slice(1) : key;
}

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  // GeoServer publishes unset text columns in several shapes. None of them is information.
  if (/^(null|none|nan|-|k\.a\.|keine angabe)$/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Turn a feature's published properties into the detail panel's rows.
 *
 * ⚠️ THE PUBLISHER'S OWN FIELDS, UNEDITED, BUT NOT NECESSARILY ALL OF THEM. This engine serves
 * datasets whose columns nobody on this side has read, so values are shown exactly as published
 * rather than tidied. The default path stops after 14 rows to keep the panel readable, and says
 * so when it truncates. Empty values are dropped rather than rendered as "unbekannt", which
 * would imply the city was asked and gave no answer.
 */
function detailFor(spec: WfsLayerSpec, properties: Record<string, unknown>): PickDetail {
  const fields: { label: string; value: string }[] = [];
  if (spec.fields?.length) {
    for (const field of spec.fields) {
      const value = text(properties[field.key]);
      if (value) fields.push({ label: field.label, value });
    }
  } else {
    let shown = 0;
    let hidden = 0;
    for (const [key, raw] of Object.entries(properties)) {
      if (HIDDEN_KEYS.test(key)) continue;
      const value = text(raw);
      if (!value) continue;
      if (shown >= 14) { hidden++; continue; }
      fields.push({ label: prettyKey(key), value });
      shown++;
    }
    // Silently dropping fields would make the panel look complete when it is not.
    if (hidden) fields.push({ label: 'Weitere Felder', value: `${hidden} nicht angezeigt` });
  }

  let title: string | null = null;
  for (const key of spec.titleFields ?? []) {
    title = text(properties[key]);
    if (title) break;
  }

  return {
    layerId: spec.id,
    title: title ?? spec.label,
    subtitle: title ? spec.label : undefined,
    accent: spec.colour,
    fields,
    source: spec.source,
  };
}

export interface WfsLayerOptions {
  placement: WorldPlacement;
  onStatus: StatusReporter;
  /** Which core to bound the request to. */
  siteId?: string;
}

export async function createWfsLayer(
  spec: WfsLayerSpec,
  options: WfsLayerOptions,
): Promise<LiveLayer> {
  const { placement, onStatus } = options;
  const siteId = options.siteId ?? 'munich';

  const group = new THREE.Group();
  group.name = spec.id;
  group.visible = false;
  placement.group.add(group);

  const abort = new AbortController();
  const owned: (THREE.BufferGeometry | THREE.Material)[] = [];
  let visible = false;
  let count = 0;
  /**
   * ⚠️ SERIALISED, for the reason the Baustellen layer documents: toggling a layer off and on
   * while its first request is in flight starts a second one, and both append their geometry —
   * the same features drawn twice, at double opacity, reported once.
   */
  let pending: Promise<void> | null = null;
  let lastStatus: { text: string; at: Date } | null = null;

  const material = new THREE.MeshBasicMaterial({
    color: spec.colour,
    // ⚠️ UNLIT ON PURPOSE, AND NOT BECAUSE THE SCENE IS UNLIT. It does have a DirectionalLight
    // and an AmbientLight; an earlier version of this comment claimed otherwise and was simply
    // wrong. The reason is that these overlays are flat cartographic fills: a lit material would
    // shade one side of a restriction area differently from the other, which reads as data.
    transparent: spec.geometry !== 'point',
    opacity: spec.geometry === 'polygon' ? 0.5 : 0.85,
    depthWrite: spec.geometry === 'point',
    side: THREE.DoubleSide,
  });
  owned.push(material);

  // One shared geometry per pin part: 3000 features must not mean 6000 buffers.
  const pinGeometry = new THREE.CylinderGeometry(PIN_RADIUS_M, PIN_RADIUS_M, PIN_HEIGHT_M, 5);
  const headGeometry = new THREE.SphereGeometry(PIN_HEAD_M, 8, 6);
  owned.push(pinGeometry, headGeometry);

  const core = placement.coreBboxUtm(siteId);

  /** See clip.mjs: extracted so the boundary cases are covered by tests. */
  const clipToCore = (points: Position[]): Position[][] =>
    clipPolylineToBox(points, core) as Position[][];

  const addPoints = (feature: Feature, detail: PickDetail): number => {
    let drawn = 0;
    for (const [easting, northing] of pointsOf(feature.geometry)) {
      const anchor = placement.toWorldUtm(easting, northing);
      const mast = new THREE.Mesh(pinGeometry, material);
      mast.position.set(anchor.x, anchor.y + PIN_HEIGHT_M / 2, anchor.z);
      mast.userData.pick = detail;
      const head = new THREE.Mesh(headGeometry, material);
      head.position.set(anchor.x, anchor.y + PIN_HEIGHT_M, anchor.z);
      head.userData.pick = detail;
      group.add(mast, head);
      drawn++;
    }
    return drawn;
  };

  /**
   * A polyline as a flat ribbon of its real width.
   *
   * ⚠️ NOT `THREE.Line`. WebGL ignores `linewidth` on almost every platform, so a line layer
   * drawn that way is a hairline that disappears the moment the camera pulls back, and its
   * apparent width would be a property of the driver rather than of the street.
   *
   * ⚠️ CLIPPED TO THE MODELLED CORE, AND THIS IS NOT OPTIONAL. A WFS bbox returns every feature
   * that INTERSECTS the box, whole. Measured on 2026-09-22, the tram and underground routes come
   * to 24 features and 200 240 vertices spanning the entire city, while the modelled core is
   * 3.25 x 3.94 km. Drawn unclipped, most of every route would hang in empty space past the edge
   * of the terrain, which reads as a rendering fault rather than as "the line continues".
   */
  const addLines = (feature: Feature, detail: PickDetail): number => {
    // A published width beats the catalogue's declared one. `widthField` is in centimetres,
    // which is how the city publishes it.
    let widthM = spec.widthM ?? 4;
    if (spec.widthField) {
      const published = Number((feature.properties ?? {})[spec.widthField]);
      if (Number.isFinite(published) && published > 0) widthM = published / 100;
    }
    const half = widthM / 2;
    let drawn = 0;
    for (const line of linesOf(feature.geometry)) {
      // Repeated vertices produce a zero-length direction and then NaN normals, which silently
      // removes the whole ribbon from the frame.
      const deduped = line.filter((point, index) =>
        index === 0 || point[0] !== line[index - 1][0] || point[1] !== line[index - 1][1]);
      for (const points of clipToCore(deduped)) {
        if (points.length < 2) continue;

        const positions: number[] = [];
        const indices: number[] = [];
        for (let i = 0; i < points.length; i++) {
          const previous = points[Math.max(0, i - 1)];
          const next = points[Math.min(points.length - 1, i + 1)];
          let dx = next[0] - previous[0];
          let dy = next[1] - previous[1];
          const length = Math.hypot(dx, dy);
          if (length === 0) { dx = 1; dy = 0; } else { dx /= length; dy /= length; }
          // Perpendicular in the easting/northing plane.
          const px = -dy * half;
          const py = dx * half;
          const left = placement.toWorldUtm(points[i][0] + px, points[i][1] + py);
          const right = placement.toWorldUtm(points[i][0] - px, points[i][1] - py);
          positions.push(
            left.x, left.y + DRAPE_OFFSET_M, left.z,
            right.x, right.y + DRAPE_OFFSET_M, right.z,
          );
          if (i > 0) {
            const base = (i - 1) * 2;
            indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        owned.push(geometry);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 2;
        mesh.userData.pick = detail;
        group.add(mesh);
        drawn++;
      }
    }
    return drawn;
  };

  const addPolygons = (feature: Feature, detail: PickDetail): number => {
    let drawn = 0;
    for (const { outer, holes } of ringsOf(feature.geometry)) {
      // Built in local metres around the ring's first vertex: handing a triangulator raw
      // seven-digit UTM eastings loses precision in float32 and produces ragged edges.
      const [originE, originN] = outer[0];
      const shape = new THREE.Shape(
        outer.map(([e, n]) => new THREE.Vector2(e - originE, n - originN))
      );
      for (const hole of holes) {
        shape.holes.push(
          new THREE.Path(hole.map(([e, n]) => new THREE.Vector2(e - originE, n - originN)))
        );
      }
      const geometry = new THREE.ShapeGeometry(shape);
      // ShapeGeometry lies in the XY plane; the world's ground plane is XZ.
      geometry.rotateX(-Math.PI / 2);
      owned.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      const anchor = placement.toWorldUtm(originE, originN);
      mesh.position.set(anchor.x, anchor.y + DRAPE_OFFSET_M, anchor.z);
      mesh.renderOrder = 2;
      mesh.userData.pick = detail;
      group.add(mesh);
      drawn++;
    }
    return drawn;
  };

  const build = (features: Feature[]): number => {
    let drawn = 0;
    for (const feature of features) {
      const detail = detailFor(spec, feature.properties ?? {});
      if (spec.geometry === 'point') drawn += addPoints(feature, detail);
      else if (spec.geometry === 'line') drawn += addLines(feature, detail);
      else drawn += addPolygons(feature, detail);
    }
    return drawn;
  };

  const load = async () => {
    if (lastStatus) {
      onStatus({ state: 'live', text: lastStatus.text, fetchedAt: lastStatus.at, count });
      return;
    }
    if (pending) return pending;
    onStatus({ state: 'loading', text: `${spec.label} wird geladen…`, fetchedAt: null, count: 0 });
    pending = (async () => {
      try {
        const box = placement.coreBboxUtm(siteId);
        const params = new URLSearchParams({
          service: 'WFS',
          version: spec.version,
          request: 'GetFeature',
          typeName: spec.typeName,
          outputFormat: 'application/json',
          srsName: 'urn:ogc:def:crs:EPSG::25832',
        });

        // ⚠️ `bbox` AND `cql_filter` CANNOT BOTH BE SENT. Measured against this GeoServer on
        // 2026-09-22, the exact refusal is "bbox and cql_filter both specified but are mutually
        // exclusive" — an HTTP 200 carrying an XML exception, so it fails as an empty layer
        // rather than as an error unless the body is inspected. When a layer needs an attribute
        // filter the extent has to travel inside the filter as a BBOX() predicate instead.
        if (spec.cqlFilter) {
          const extent = box
            ? `BBOX(${spec.geometryField},${box.minE},${box.minN},${box.maxE},${box.maxN},'EPSG:25832') AND `
            : '';
          params.set('cql_filter', `${extent}(${spec.cqlFilter})`);
        } else if (box) {
          // The CRS is named in the bbox itself. Without it the server applies the axis order of
          // its own default CRS, and EPSG:25832 is easting-then-northing while the WFS default
          // for some layers is not — the difference is silent and returns the wrong part of the
          // city rather than an error.
          params.set(
            'bbox',
            `${box.minE},${box.minN},${box.maxE},${box.maxN},urn:ogc:def:crs:EPSG::25832`,
          );
        }
        if (spec.maxFeatures) params.set('maxFeatures', String(spec.maxFeatures));

        const data = await fetchJson<FeatureCollection>(`${spec.endpoint}?${params}`, {
          signal: abort.signal,
          timeoutMs: 20000,
          maxBytes: spec.maxBytes,
        });
        if (abort.signal.aborted) return;
        const features = Array.isArray(data.features) ? data.features : [];
        build(features);
        count = features.length;
        const at = new Date();
        const unit = spec.unit ?? 'Einträge';
        // ⚠️ A CAP MUST BE VISIBLE. `maxFeatures` silently truncates, so a capped layer would
        // otherwise state a confident count that is really "as many as I allowed myself", and
        // somebody would read it as the number of parking sides in the district.
        const capped = spec.maxFeatures !== undefined && features.length >= spec.maxFeatures;
        const label = features.length === 0
          ? 'keine Einträge im Kartenausschnitt'
          : capped
            ? `${features.length} ${unit} (Anzeige begrenzt)`
            : `${features.length} ${unit}`;
        const text = `${label} · Stand ${clock(at)}`;
        lastStatus = { text, at };
        if (visible) onStatus({ state: 'live', text, fetchedAt: at, count });
      } catch (error) {
        if (abort.signal.aborted) return;
        if (visible) {
          onStatus({
            state: 'error',
            text: `${spec.label} ${describeError(error)}`,
            fetchedAt: null,
            count: 0,
          });
        }
      } finally {
        pending = null;
      }
    })();
    return pending;
  };

  return {
    id: spec.id,
    setVisible(next: boolean) {
      visible = next;
      group.visible = next;
      if (next) void load();
      else onStatus({ state: 'idle', text: 'aus', fetchedAt: null, count: 0 });
      placement.invalidate();
    },
    dispose() {
      abort.abort();
      group.clear();
      for (const resource of owned) resource.dispose();
      owned.length = 0;
      placement.group.remove(group);
    },
  };
}
