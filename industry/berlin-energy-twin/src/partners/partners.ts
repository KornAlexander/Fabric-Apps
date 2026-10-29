/**
 * The three partners' assets, as the lenses see them (PLAN §4, §5, D33-D36).
 *
 * Pure functions over the baked files, so every figure the app shows is tested
 * here and can be checked against the report later (agreement gate, §6). Nothing
 * here invents a value: a unit without a position is aggregated by postcode
 * (D18), a roof's potential is the solar atlas's own estimate and says so.
 */

export type Lens = 'degewo' | 'bvg' | 'bsw'
export const LENSES: Lens[] = ['degewo', 'bvg', 'bsw']

export type Unit = {
  id: string
  name: string
  operator: string
  carrier: string
  kwGross: number | null
  status: string
  commissioned: string | null
  plz: string | null
  mieterstrom: boolean
  queries: string[]
}

export type Placement = {
  method: 'register' | 'address' | 'address-osm' | 'depot' | 'postcode'
  lon?: number
  lat?: number
  depot?: string
  buildings?: number[]
}

type Polygonal = { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown }

export type RankedRoof = {
  id: number
  lon: number
  lat: number
  potKw: number
  areaM2: number
  fn: string | null
  addr: string
  units: string[]
  installedKw: number
  estates?: string[]
  outline?: Polygonal
  /** a 1.2 m band inside the footprint: the outline raised onto the roof (D33) */
  ring?: Polygonal
}

export type Estate = {
  id: string
  name: string
  kind: 'named' | 'cluster'
  outline: Polygonal | null
}

export type Depot = {
  id: string
  name: string
  kind: string
  status: 'operating' | 'construction'
  deal2025: boolean
  source: string
  lon: number | null
  lat: number | null
  outline?: Polygonal | null
  units: string[]
  kwGross: number
}

export type PostcodeArea = { plz: string; lon: number; lat: number; outline: Polygonal }

export type SitesData = {
  sources: Record<string, string>
  estates: Estate[]
  depots: Depot[]
  buildings: RankedRoof[]
  postcodes: PostcodeArea[]
  placements: Record<string, Placement>
}

export type RoofHeights = { roofs: Record<string, { site: string; groundM: number; roofM: number }> }

/** MaStR's carrier name for photovoltaics. */
export const SOLAR = 'Solare Strahlungsenergie'
export const isSolar = (u: Pick<Unit, 'carrier'>) => u.carrier === SOLAR

/** Units of one lens. A unit belongs to every partner whose register query found it. */
export function lensUnits(units: readonly Unit[], lens: Lens): Unit[] {
  return units.filter((u) => u.queries.includes(lens))
}

/** Share of a roof's estimated potential already installed, 0..1 (capped), null without potential. */
export function roofShare(r: Pick<RankedRoof, 'potKw' | 'installedKw'>): number | null {
  if (!(r.potKw > 0)) return null
  return Math.min(1, r.installedKw / r.potKw)
}

/** Potential still open on a roof, kWp, never negative. */
export function openKw(r: Pick<RankedRoof, 'potKw' | 'installedKw'>): number {
  return Math.max(0, r.potKw - r.installedKw)
}

/** Ranked roofs, largest open potential first. */
export function rankRoofs(roofs: readonly RankedRoof[]): RankedRoof[] {
  return [...roofs].sort((a, b) => openKw(b) - openKw(a))
}

export type PostcodeAggregate = { plz: string; kw: number; n: number }

/** Units placed by postcode only (D18), summed per postcode. */
export function postcodeAggregates(
  units: readonly Unit[],
  placements: Record<string, Placement>,
): PostcodeAggregate[] {
  const by = new Map<string, PostcodeAggregate>()
  for (const u of units) {
    // Solar only: the shading is read as kWp next to the solar potential (review 2026-10-28).
    if (!isSolar(u) || placements[u.id]?.method !== 'postcode' || !u.plz) continue
    const a = by.get(u.plz) ?? { plz: u.plz, kw: 0, n: 0 }
    a.kw += u.kwGross ?? 0
    a.n += 1
    by.set(u.plz, a)
  }
  return [...by.values()].sort((a, b) => b.kw - a.kw)
}

/**
 * ⚠️ `units`, `kw`, `located` and `postcodeOnly` are SOLAR ONLY. The register
 * queries also return wind, gas CHP, biomass and storage (Stadtwerke 3.45 MW
 * wind; degewo 1.6 MW biomass), and calling the all-carrier sum "Solar"
 * overstated degewo PV by more than double (review 2026-10-28). The rest is in
 * `other`, named next to the solar figure, and in `allKw`.
 */
export type LensSummary = {
  units: number
  kw: number
  located: number
  postcodeOnly: number
  mieterstrom: number
  /** every carrier, for the fleet total */
  allUnits: number
  allKw: number
  /** non-solar carriers, largest first */
  other: { carrier: string; kw: number; n: number }[]
  /** degewo: ranked roofs and their open potential */
  roofs?: { count: number; openKw: number; potKw: number; installedKw: number }
  /** BVG: sites and how many are being built or are in the 2025 agreement */
  depots?: { total: number; construction: number; deal2025: number }
}

export function lensSummary(lens: Lens, units: readonly Unit[], sites: SitesData): LensSummary {
  const all = lensUnits(units, lens)
  const mine = all.filter(isSolar)
  const other = new Map<string, { carrier: string; kw: number; n: number }>()
  for (const u of all) {
    if (isSolar(u)) continue
    const o = other.get(u.carrier) ?? { carrier: u.carrier, kw: 0, n: 0 }
    o.kw += u.kwGross ?? 0
    o.n += 1
    other.set(u.carrier, o)
  }
  const sum: LensSummary = {
    units: mine.length,
    kw: mine.reduce((a, u) => a + (u.kwGross ?? 0), 0),
    located: mine.filter((u) => sites.placements[u.id] && sites.placements[u.id].method !== 'postcode').length,
    postcodeOnly: mine.filter((u) => sites.placements[u.id]?.method === 'postcode').length,
    mieterstrom: mine.filter((u) => u.mieterstrom).length,
    allUnits: all.length,
    allKw: all.reduce((a, u) => a + (u.kwGross ?? 0), 0),
    other: [...other.values()].sort((a, b) => b.kw - a.kw),
  }
  if (lens === 'degewo') {
    sum.roofs = {
      count: sites.buildings.length,
      openKw: sites.buildings.reduce((a, r) => a + openKw(r), 0),
      potKw: sites.buildings.reduce((a, r) => a + r.potKw, 0),
      installedKw: sites.buildings.reduce((a, r) => a + r.installedKw, 0),
    }
  }
  if (lens === 'bvg') {
    sum.depots = {
      total: sites.depots.length,
      construction: sites.depots.filter((d) => d.status === 'construction').length,
      deal2025: sites.depots.filter((d) => d.deal2025).length,
    }
  }
  return sum
}

// --- GeoJSON for the map --------------------------------------------------------

type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: unknown }
export type FC = { type: 'FeatureCollection'; features: Feature[] }
const fc = (features: Feature[]): FC => ({ type: 'FeatureCollection', features })

/** Located units as points, with one 0/1 flag per partner for the lens highlight. */
export function unitPoints(units: readonly Unit[], placements: Record<string, Placement>): FC {
  return fc(
    units.flatMap((u) => {
      const p = placements[u.id]
      if (!p || p.lon === undefined || p.lat === undefined) return []
      return [
        {
          type: 'Feature' as const,
          properties: {
            id: u.id,
            kw: u.kwGross ?? 0,
            method: p.method,
            degewo: u.queries.includes('degewo') ? 1 : 0,
            bvg: u.queries.includes('bvg') ? 1 : 0,
            bsw: u.queries.includes('bsw') ? 1 : 0,
          },
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        },
      ]
    }),
  )
}

/** Roof bands with the share used, for the outline colour (D33). */
export function roofOutlines(roofs: readonly RankedRoof[], heights?: RoofHeights | null): FC {
  return fc(
    roofs
      .filter((r) => r.ring ?? r.outline)
      .map((r) => ({
        type: 'Feature' as const,
        properties: {
          id: r.id,
          share: roofShare(r) ?? 0,
          open: openKw(r),
          roofM: heights?.roofs[String(r.id)]?.roofM ?? 0,
        },
        geometry: r.ring ?? r.outline,
      })),
  )
}

/**
 * One point per ranked roof carrying its open potential, drawn as a label ON the roof (D53).
 * Replaces the D33 column (1 m = 2 kWp), which stood up to 134 m on a 15 m car park: a chart
 * mark the size of a tower broke the strict 1:1 rule. Everything in 3D is now real size.
 */
export function roofLabels(roofs: readonly RankedRoof[]): FC {
  return fc(
    roofs
      .filter((r) => openKw(r) > 0)
      .map((r) => ({
        type: 'Feature' as const,
        properties: { id: r.id, open: Math.round(openKw(r)) },
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      })),
  )
}

export function estateAreas(estates: readonly Estate[]): FC {
  return fc(
    estates
      .filter((e) => e.outline)
      .map((e) => ({ type: 'Feature' as const, properties: { id: e.id, name: e.name, named: e.kind === 'named' ? 1 : 0 }, geometry: e.outline })),
  )
}

/** BVG sites: outlines where OSM has one, points otherwise; Alt-Moabit has neither (D18). */
export function depotFeatures(depots: readonly Depot[]): { areas: FC; points: FC } {
  const props = (d: Depot) => ({ id: d.id, name: d.name, building: d.status === 'construction' ? 1 : 0, kw: d.kwGross })
  return {
    areas: fc(depots.filter((d) => d.outline).map((d) => ({ type: 'Feature' as const, properties: props(d), geometry: d.outline }))),
    points: fc(
      depots
        .filter((d) => d.lon !== null && d.lat !== null)
        .map((d) => ({ type: 'Feature' as const, properties: props(d), geometry: { type: 'Point', coordinates: [d.lon, d.lat] } })),
    ),
  }
}

/** Postcode areas shaded by the lens's unlocated kWp (D34). */
export function postcodeFills(areas: readonly PostcodeArea[], agg: readonly PostcodeAggregate[]): FC {
  const by = new Map(agg.map((a) => [a.plz, a]))
  return fc(
    areas.flatMap((a) => {
      const g = by.get(a.plz)
      if (!g) return []
      return [{ type: 'Feature' as const, properties: { plz: a.plz, kw: g.kw, n: g.n }, geometry: a.outline }]
    }),
  )
}

/** Where a lens's assets are, for the camera when the lens is picked. */
export function lensBounds(
  lens: Lens,
  units: readonly Unit[],
  sites: SitesData,
): [[number, number], [number, number]] | null {
  const pts: [number, number][] = []
  for (const u of lensUnits(units, lens)) {
    const p = sites.placements[u.id]
    if (p?.lon !== undefined && p.lat !== undefined) pts.push([p.lon, p.lat])
  }
  if (lens === 'bvg') for (const d of sites.depots) if (d.lon !== null && d.lat !== null) pts.push([d.lon, d.lat])
  if (!pts.length) return null
  const lons = pts.map((p) => p[0])
  const lats = pts.map((p) => p[1])
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ]
}
