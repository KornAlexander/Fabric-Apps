import * as THREE from 'three';

import type { LiveLayer, PickDetail, WorldPlacement } from '../map/worldScene';
import { clock, describeError, fetchJson, type StatusReporter } from './source';

/**
 * Baustellen und vorübergehende Haltverbote der Landeshauptstadt München.
 *
 * This is the layer that makes the whole map a cross-organisation artefact rather than a picture.
 * A fibre trench, a district-heating trench and a road resurfacing are three organisations doing
 * the same thing to the same street, and the city's own open dataset is where all three surface.
 *
 * Source: `mor_wfs:baustellen_opendata` on geoportal.muenchen.de, measured on 2026-09-21 as 5614
 * live features — 3112 `Baumaßnahme` and 2502 `Vorübergehendes Haltverbot`. It refreshes daily
 * and carries the coming four weeks, so the counts move; they are read from the response, never
 * printed from memory.
 *
 * ⚠️ THE DATA IS ALREADY IN EPSG:25832, the grid the terrain was built in, so it is placed
 * without a projection round trip.
 *
 * ⚠️ THE REQUEST IS BOUNDED TO THE CITY CORE. The dataset covers the whole city; this app models
 * 3.25 x 3.94 km of it. Asking for everything would download several megabytes of polygons whose
 * only possible destination is outside the terrain.
 *
 * ⚠️ WHAT THIS LAYER MUST NOT BE READ AS. A polygon here is a notified restriction with a start
 * and an end date. It is not a statement about who is digging, what is underneath, whether the
 * work is running to plan, or whether two adjacent entries belong to one project. The app shows
 * the notification and the dates it carries, and nothing else.
 */

const WFS = 'https://geoportal.muenchen.de/geoserver/mor_wfs/ows';
const TYPE_NAME = 'mor_wfs:baustellen_opendata';

/** Metres above the terrain. Enough to clear the drape without floating visibly. */
const DRAPE_OFFSET_M = 1.2;

const COLOUR = {
  // Construction: warm amber, the convention on every German roadworks sign.
  Baumaßnahme: 0xf08a24,
  // Temporary no-parking: pure red, the user's standing colour for a hard restriction.
  'Vorübergehendes Haltverbot': 0xff0000,
} as const;

const FALLBACK_COLOUR = 0x9aa3ab;

interface Feature {
  id?: string;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: {
    art?: string;
    strasse_hausnr?: string;
    betroffene_bereiche?: string;
    beschreibung?: string;
    beeintraechtigung?: string;
    weitere_info?: string | null;
    kontakt_oeffentlich?: string | null;
    beginn_datum_kombiniert?: string;
    ende_datum_kombiniert?: string;
    fachliche_id?: string | null;
  };
}
interface FeatureCollection { features?: Feature[] }

type Ring = [number, number][];

/** Polygon and MultiPolygon, flattened to a list of outer rings with their holes. */
function ringsOf(geometry: Feature['geometry']): { outer: Ring; holes: Ring[] }[] {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const polygons: Ring[][] =
    geometry.type === 'MultiPolygon'
      ? (geometry.coordinates as Ring[][])
      : geometry.type === 'Polygon'
        ? [geometry.coordinates as Ring[]]
        : [];
  const result: { outer: Ring; holes: Ring[] }[] = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) continue;
    const [outer, ...holes] = polygon;
    if (!Array.isArray(outer) || outer.length < 4) continue;
    result.push({ outer, holes: holes.filter((hole) => Array.isArray(hole) && hole.length >= 4) });
  }
  return result;
}

/**
 * Turn the city's record into the panel's label/value list.
 *
 * ⚠️ VERBATIM, AND THAT IS DELIBERATE EVEN WHERE THE SOURCE IS UNTIDY. Some `beeintraechtigung`
 * values arrive with entries run together ("Halbseitige SperreGehweg gesperrt") because that is
 * how they are published. Splitting or tidying them would mean inventing a separator the city
 * did not write and risk changing what a restriction says. Empty fields are dropped rather than
 * shown as "unbekannt", which would imply the city was asked and did not answer.
 */
function detailFor(
  properties: NonNullable<Feature['properties']>,
  colour: number,
  reference?: { id?: string; easting?: number; northing?: number },
): PickDetail {
  const text = (value: string | null | undefined) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed.length ? trimmed : null;
  };
  const fields: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null | undefined) => {
    const usable = text(value);
    if (usable) fields.push({ label, value: usable });
  };

  const from = text(properties.beginn_datum_kombiniert);
  const to = text(properties.ende_datum_kombiniert);
  if (from && to) add('Zeitraum', `${from} bis ${to}`);
  else if (from) add('Beginn', from);
  else if (to) add('Ende', to);

  add('Betroffene Bereiche', properties.betroffene_bereiche);
  add('Beeinträchtigung', properties.beeintraechtigung);
  add('Beschreibung', properties.beschreibung);
  add('Weitere Informationen', properties.weitere_info);
  add('Kontakt', properties.kontakt_oeffentlich);

  return {
    layerId: 'baustellen',
    title: text(properties.strasse_hausnr) ?? 'Ohne Ortsangabe',
    subtitle: text(properties.art) ?? undefined,
    accent: colour,
    fields,
    source: 'Landeshauptstadt München, offene Daten (mor_wfs:baustellen_opendata)',
    // ⚠️ `feature.id`, NOT `fachliche_id`. Measured over 400 records: the city's own reference is
    // null on 83 of them, so keying a note on it would leave a fifth of the Baustellen
    // unannotatable, silently.
    baustelleId: reference?.id,
    easting: reference?.easting,
    northing: reference?.northing,
  };
}

export interface BaustellenOptions {
  placement: WorldPlacement;
  onStatus: StatusReporter;
  /** Which core to bound the request to. */
  siteId?: string;
  endpoint?: string;
}

export async function createBaustellenLayer(options: BaustellenOptions): Promise<LiveLayer> {
  const { placement, onStatus } = options;
  const endpoint = options.endpoint ?? WFS;
  const siteId = options.siteId ?? 'munich';

  const group = new THREE.Group();
  group.name = 'baustellen';
  group.visible = false;
  placement.group.add(group);

  const abort = new AbortController();
  const owned: (THREE.BufferGeometry | THREE.Material)[] = [];
  let visible = false;
  let count = 0;
  /**
   * The single in-flight load, if any.
   *
   * ⚠️ SERIALISED ON PURPOSE. Toggling the layer off and on again while the first request was
   * still running started a second one, and both appended their polygons — the same roadworks
   * drawn twice, at double opacity, with the count reported once.
   */
  let pending: Promise<void> | null = null;
  let lastStatus: { text: string; at: Date } | null = null;

  const materials = new Map<number, THREE.MeshBasicMaterial>();
  const materialFor = (colour: number) => {
    let material = materials.get(colour);
    if (!material) {
      // ⚠️ MeshBasicMaterial on purpose. Every other surface in this scene bakes its own shading
      // in a custom shader and there are no lights at all, so a lit material would render black.
      material = new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      materials.set(colour, material);
      owned.push(material);
    }
    return material;
  };

  const build = (features: Feature[]) => {
    let drawn = 0;
    const byKind = new Map<string, number>();

    for (const feature of features) {
      const properties = feature.properties ?? {};
      const kind = properties.art ?? 'unbekannt';
      const colour = (COLOUR as Record<string, number>)[kind] ?? FALLBACK_COLOUR;
      // The centroid of the first ring, so a note can be placed without re-reading the geometry.
      const rings = ringsOf(feature.geometry);
      let reference: { id?: string; easting?: number; northing?: number } | undefined;
      if (rings.length > 0 && rings[0].outer.length > 0) {
        const outer = rings[0].outer;
        reference = {
          id: typeof feature.id === 'string' ? feature.id : undefined,
          easting: outer.reduce((sum, p) => sum + p[0], 0) / outer.length,
          northing: outer.reduce((sum, p) => sum + p[1], 0) / outer.length,
        };
      }
      // One detail object per FEATURE, shared by all its rings: a multipolygon roadworks is one
      // restriction with several patches, not several restrictions.
      const detail = detailFor(properties, colour, reference);

      for (const { outer, holes } of ringsOf(feature.geometry)) {
        // A shape is built in local metres around the ring's first vertex, so the numbers the
        // triangulator sees are small. Handing it raw UTM eastings — seven digits — loses
        // precision in float32 and produces visibly ragged edges.
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

        const mesh = new THREE.Mesh(geometry, materialFor(colour));
        const anchor = placement.toWorldUtm(originE, originN);
        // A restriction is a flat patch of street. It is laid at the terrain height under its own
        // first vertex rather than draped per-vertex, which is honest over a few tens of metres
        // of pancake-flat Maxvorstadt and would not be in the Alps.
        mesh.position.set(anchor.x, anchor.y + DRAPE_OFFSET_M, anchor.z);
        mesh.renderOrder = 2;
        mesh.userData.pick = detail;
        mesh.userData.baseColour = colour;
        group.add(mesh);
        drawn++;
      }
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    }
    count = features.length;
    const summary = [...byKind.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => `${n} ${kind === 'Vorübergehendes Haltverbot' ? 'Haltverbote' : kind}`)
      .join(' · ');
    return { drawn, summary };
  };

  const load = async () => {
    if (lastStatus) {
      // Already drawn this session. Re-state what is on screen, rather than leaving the panel
      // saying "aus" above a visible layer — which is what it used to do.
      onStatus({ state: 'live', text: lastStatus.text, fetchedAt: lastStatus.at, count });
      return;
    }
    if (pending) return pending;
    onStatus({ state: 'loading', text: 'Baustellen werden geladen…', fetchedAt: null, count: 0 });
    pending = (async () => {
      try {
        const box = placement.coreBboxUtm(siteId);
        const params = new URLSearchParams({
          service: 'WFS',
          version: '1.1.0',
          request: 'GetFeature',
          typeName: TYPE_NAME,
          outputFormat: 'application/json',
        });
        if (box) {
          // WFS 1.1.0 with an explicit CRS URN: EPSG:25832 is easting-then-northing, the same
          // order everything else in this app uses.
          params.set('bbox', `${box.minE},${box.minN},${box.maxE},${box.maxN},urn:ogc:def:crs:EPSG::25832`);
        }
        const data = await fetchJson<FeatureCollection>(`${endpoint}?${params}`, {
          signal: abort.signal,
          timeoutMs: 20000,
        });
        if (abort.signal.aborted) return;
        const features = Array.isArray(data.features) ? data.features : [];
        const { summary } = build(features);
        const at = new Date();
        const text = features.length === 0
          ? `keine Einträge im Kartenausschnitt · Stand ${clock(at)}`
          : `${summary} · Stand ${clock(at)}`;
        lastStatus = { text, at };
        if (visible) onStatus({ state: 'live', text, fetchedAt: at, count });
      } catch (error) {
        if (abort.signal.aborted) return;
        if (visible) {
          onStatus({ state: 'error', text: `Baustellen ${describeError(error)}`, fetchedAt: null, count: 0 });
        }
      } finally {
        pending = null;
      }
    })();
    return pending;
  };

  /**
   * Material for the polygon the user has selected.
   *
   * ⚠️ Opaque and drawn last, so the selected patch is unmistakable against a busy orthophoto
   * where dozens of translucent amber shapes overlap. Without a highlight the panel would name a
   * street and leave the viewer hunting for which of the shapes it belongs to.
   */
  const highlight = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  owned.push(highlight);
  let highlighted: THREE.Mesh[] = [];

  const applyHighlight = (detail: PickDetail | null) => {
    for (const mesh of highlighted) {
      mesh.material = materialFor(mesh.userData.baseColour as number);
      mesh.renderOrder = 2;
    }
    highlighted = [];
    if (!detail || detail.layerId !== 'baustellen') return;
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      // Identity comparison: every ring of one feature shares one detail object, so selecting a
      // multipolygon highlights all of its patches together.
      if (child.userData.pick !== detail) continue;
      child.material = highlight;
      child.renderOrder = 3;
      highlighted.push(child);
    }
  };

  return {
    id: 'baustellen',
    setVisible(next) {
      visible = next;
      group.visible = next;
      if (next) void load();
      else onStatus({ state: 'idle', text: 'aus', fetchedAt: null, count: 0 });
    },
    onPicked(detail) { applyHighlight(detail); },
    dispose() {
      abort.abort();
      group.clear();
      for (const resource of owned) resource.dispose();
      owned.length = 0;
      materials.clear();
      highlighted = [];
      placement.group.remove(group);
      visible = false;
    },
  };
}
