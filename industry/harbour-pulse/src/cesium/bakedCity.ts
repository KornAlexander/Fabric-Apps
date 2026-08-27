import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  Credit,
  EllipsoidGeometry,
  GeometryInstance,
  Matrix4,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  Transforms,
  WallGeometry,
  type CreditDisplay,
  type Scene,
} from 'cesium';

/**
 * ── The baked city ─────────────────────────────────────────────────────────────────────────────
 *
 * Buildings and trees for the keyless modes, from files committed by `scripts/bake-*.mjs`.
 *
 * ⚠️ PRIMITIVES, NOT ENTITIES. The previous version added one Cesium Entity per building, which is
 * fine for the ~1.7k footprints it had and hopeless for 12.5k: entities each carry their own
 * change-detection and draw path. These go in as a handful of batched Primitives instead — two for
 * the buildings (roofs and walls need different colours, and a per-instance colour applies to a
 * whole geometry) and one for the trees.
 *
 * ⚠️ Heights are ELLIPSOIDAL. The baked files store metres above SEA LEVEL, and Cesium works from
 * the ellipsoid, so every height gets the geoid offset added — the same ~23 m that keeps the ferry
 * models floating on the water rather than under it.
 */

export interface BakedBuilding {
  r: [number, number][];
  h: number;
  g: number;
  rf: string;
  wl: string;
  m?: 1;
  n?: string;
}

export interface BakedTree {
  o: number;
  a: number;
  g: number;
  h: number;
  c: number;
}

export interface BakedCity {
  buildings: BakedBuilding[];
  trees: BakedTree[];
  geoidOffsetM: number;
  buildingSource: string;
  treeSource: string;
}

export async function loadBakedCity(signal?: AbortSignal): Promise<BakedCity> {
  const [b, t] = await Promise.all([
    fetch('/data/buildings-sydney.json', { signal }).then((r) => (r.ok ? r.json() : null)),
    fetch('/data/trees-sydney.json', { signal }).then((r) => (r.ok ? r.json() : null)),
  ]);
  return {
    buildings: b?.buildings ?? [],
    trees: t?.trees ?? [],
    geoidOffsetM: b?.geoidOffsetM ?? t?.geoidOffsetM ?? 0,
    buildingSource: b?.source ?? '',
    treeSource: t?.source ?? '',
  };
}

/**
 * Wall colour, derived per building from its own MEASURED roof rather than taken straight from the
 * class palette.
 *
 * ⚠️ The palette alone put every building within a few percent of the same pale beige. From above
 * that is invisible; from ferry height the whole city reads as one sheet of cardboard. Shading each
 * building's own roof sample down and pulling it toward the class tint keeps the classification
 * meaningful while giving 12.5k buildings 12.5k slightly different walls.
 *
 * Still honest about provenance: the roof is measured, this is openly a derivation of it.
 *
 * ⚠️ The roof must DOMINATE the blend. An earlier 62/38 split let the pale class tint pull dark
 * roofs UP, so a terracotta building got a wall lighter than its own roof — and, worse, every
 * building drifted back toward the same tone, which is the cardboard problem returning by another
 * route. At 75/25 the wall tracks its own roof and the class only tints it.
 */
export function wallColour(roofHex: string, classHex: string): Color {
  const roof = Color.fromCssColorString(roofHex);
  const tint = Color.fromCssColorString(classHex);
  const mix = (a: number, b: number) => a * 0.75 + b * 0.25;
  // Walls face sideways rather than at the sky, so they sit in less light than the roof above them.
  const shade = 0.72;
  return new Color(
    Math.min(1, mix(roof.red, tint.red) * shade),
    Math.min(1, mix(roof.green, tint.green) * shade),
    Math.min(1, mix(roof.blue, tint.blue) * shade),
    1,
  );
}

/**
 * Roofs and walls as two batched primitives.
 *
 * ⚠️ The roof is a separate flat polygon at the top rather than `PolygonGeometry`'s own
 * `extrudedHeight`, because an extruded polygon is ONE geometry and therefore one per-instance
 * colour — which is what forced the old version to paint the whole city a single grey.
 */
export function buildingPrimitives(city: BakedCity): Primitive[] {
  const roofs: GeometryInstance[] = [];
  const walls: GeometryInstance[] = [];
  const offset = city.geoidOffsetM;

  for (const b of city.buildings) {
    const flat: number[] = [];
    for (const [lon, lat] of b.r) flat.push(lon, lat);
    if (flat.length < 8) continue;

    const base = b.g + offset;
    const top = base + b.h;
    const positions = Cartesian3.fromDegreesArray(flat);

    try {
      roofs.push(
        new GeometryInstance({
          geometry: new PolygonGeometry({
            polygonHierarchy: new PolygonHierarchy(positions),
            height: top,
            vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(b.rf)),
          },
        }),
      );
      walls.push(
        new GeometryInstance({
          geometry: WallGeometry.fromConstantHeights({
            positions,
            minimumHeight: base,
            maximumHeight: top,
            vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(wallColour(b.rf, b.wl)),
          },
        }),
      );
    } catch {
      // A self-intersecting OSM footprint throws in the geometry builder. Skipping one building is
      // the right answer; failing the whole city because of one bad ring is not.
    }
  }

  const appearance = () => new PerInstanceColorAppearance({ flat: false, translucent: false });
  return [
    new Primitive({ geometryInstances: walls, appearance: appearance(), asynchronous: true }),
    new Primitive({ geometryInstances: roofs, appearance: appearance(), asynchronous: true }),
  ];
}

/**
 * Canopies as one batched primitive: a single low-poly sphere reused for every tree and scaled per
 * instance through its model matrix, so 8.8k trees cost one geometry and one draw.
 */
export function treePrimitive(city: BakedCity): Primitive | null {
  if (!city.trees.length) return null;
  const offset = city.geoidOffsetM;

  // One shared unit sphere. Deliberately coarse — at ferry altitude a canopy is a few pixels.
  const unit = new EllipsoidGeometry({
    radii: new Cartesian3(1, 1, 1),
    stackPartitions: 6,
    slicePartitions: 8,
    vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
  });

  const instances = city.trees.map((t, i) => {
    // Sit the canopy on its own trunk: centre at ~65% of the tree's height.
    const centre = Cartesian3.fromDegrees(t.o, t.a, t.g + offset + t.h * 0.65);
    const enu = Transforms.eastNorthUpToFixedFrame(centre);
    const scale = new Cartesian3(t.c, t.c, Math.max(t.h * 0.42, t.c * 0.75));
    const modelMatrix = Matrix4.multiplyByScale(enu, scale, new Matrix4());
    // Vary the green a little so a park does not read as one moulded lump.
    const v = ((i * 2654435761) >>> 0) / 0xffffffff;
    const colour = Color.fromHsl(0.26 + v * 0.045, 0.34 + v * 0.16, 0.24 + v * 0.1, 1);
    return new GeometryInstance({
      geometry: unit,
      modelMatrix,
      attributes: { color: ColorGeometryInstanceAttribute.fromColor(colour) },
    });
  });

  return new Primitive({
    geometryInstances: instances,
    appearance: new PerInstanceColorAppearance({ flat: false, translucent: false }),
    asynchronous: true,
  });
}

/**
 * Add everything to the scene and hand back a disposer.
 *
 * ⚠️ The credits are not decoration. The footprints, heights and tree positions are OpenStreetMap
 * under ODbL, which REQUIRES attribution wherever the data is shown, and baking it into the bundle
 * does not lift that. Cesium shows imagery and terrain credits by itself, but primitives carry
 * none, so these have to be registered explicitly or the one layer with a share-alike licence
 * would be the only unattributed thing on screen.
 */
export function addBakedCity(scene: Scene, city: BakedCity, credits?: CreditDisplay): () => void {
  const prims: Primitive[] = [...buildingPrimitives(city)];
  const trees = treePrimitive(city);
  if (trees) prims.push(trees);
  for (const p of prims) scene.primitives.add(p);

  const added: Credit[] = [];
  if (credits) {
    for (const text of new Set([city.buildingSource, city.treeSource].filter(Boolean))) {
      const credit = new Credit(text, false);
      credits.addStaticCredit(credit);
      added.push(credit);
    }
  }

  return () => {
    for (const p of prims) {
      if (!p.isDestroyed?.()) scene.primitives.remove(p);
    }
    for (const c of added) credits?.removeStaticCredit(c);
  };
}
