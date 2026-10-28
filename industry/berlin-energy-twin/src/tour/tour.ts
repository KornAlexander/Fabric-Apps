/**
 * The guided tour (PLAN §5, Phase 4; decided 2026-10-28): seven stops, the
 * presenter clicks Next, the camera flies and holds still, a caption card at
 * the bottom says what is on screen.
 *
 * Every number in a caption is computed here from the baked files, never typed
 * into a string, so the tour cannot drift from the lenses or the report. The
 * stops pick their subject from the data too (the largest open roof, the named
 * estate with most open potential, the largest BVG site), so a re-bake keeps
 * the story true. BVG live vehicles and the report window slot in as stops once
 * they exist (Phase 3, Phase 5).
 */
import type { Station } from '../charging/charging'
import type { StringKey } from '../i18n/strings'
import { estateReach, mergeNested, reachSummary, type EstateReach } from '../partners/chargingGap'
import { lensSummary, openKw, rankRoofs, type Estate, type Lens, type SitesData, type Unit } from '../partners/partners'

export type TourCamera = { center: [number, number]; zoom: number; pitch: number; bearing: number }
export type Badge = 'estimate' | 'aggregated' | 'airline'

export type TourStop = {
  id: 'overview' | 'hero' | 'estate' | 'charging' | 'bvg' | 'bsw' | 'close'
  lens: Lens
  /** buildings and aerial photo on (D26) */
  realism: boolean
  camera: TourCamera
  /** the charging-gap outlines (stop 4) */
  overlay: 'gap' | null
  title: StringKey
  body: StringKey
  figureLabel: StringKey
  /** filled into title, body and figure label */
  params: Record<string, string>
  figure: string
  badges: Badge[]
  source: StringKey
}

export type TourData = { units: readonly Unit[]; sites: SitesData; stations: readonly Station[] }
export type TourFormat = { n: (v: number) => string; kw: (v: number) => string; pct: (share: number) => string; carrier: (c: string) => string }

/** MaStR carriers the partners' register queries return; each has a `carrier.<name>` string. */
export const CARRIERS = ['Solare Strahlungsenergie', 'Wind', 'Erdgas', 'andere Gase', 'Speicher', 'Biomasse']

/** Berlin as a whole, centred ~5 km south so the city sits above the caption card. */
const CITY: TourCamera = { center: [13.405, 52.455], zoom: 9.9, pitch: 35, bearing: 0 }
/** One building or depot fills the middle (same as the list clicks, SITE_VIEW in App). */
const SITE = { zoom: 17.2, pitch: 58, bearing: -20 }

export function centroid(outline: Estate['outline']): [number, number] | null {
  if (!outline) return null
  const c = outline.coordinates as unknown
  const ring = (outline.type === 'Polygon' ? (c as [number, number][][])[0] : (c as [number, number][][][])[0][0]) ?? []
  if (!ring.length) return null
  let x = 0
  let y = 0
  for (const [lo, la] of ring) {
    x += lo
    y += la
  }
  return [x / ring.length, y / ring.length]
}

/** Gap estates as GeoJSON for the map overlay: `bswGap` true draws red. */
export function gapFeatures(estates: readonly Estate[], reach: readonly EstateReach[]) {
  const by = new Map(reach.map((r) => [r.id, r]))
  const areas = estates
    .filter((e) => e.outline && by.has(e.id))
    .map((e) => ({
      type: 'Feature' as const,
      geometry: e.outline as never,
      properties: { id: e.id, name: e.name, bswGap: by.get(e.id)!.bswGap, points: by.get(e.id)!.within[300].points },
    }))
  // A gap estate is a few hundred metres across: at city zoom its outline is a
  // speck, so it also gets a ring marker at its centre.
  const markers = areas
    .filter((a) => a.properties.bswGap)
    .map((a) => ({ ...a, geometry: { type: 'Point', coordinates: centroid(a.geometry)! } as never }))
  return { type: 'FeatureCollection' as const, features: [...areas, ...markers] }
}

/** Short name of an estate: the named ones as they are, clusters by their first street. */
function shortName(name: string): string {
  const m = name.match(/^\d{5} · ([^,…]+)/)
  return (m ? m[1] : name).trim()
}

export function buildTour(d: TourData, f: TourFormat, lang: 'de' | 'en'): TourStop[] {
  const sum = (l: Lens) => lensSummary(l, d.units, d.sites)
  const degewo = sum('degewo')
  const bvg = sum('bvg')
  const bsw = sum('bsw')
  const stops: TourStop[] = []

  // Non-solar capacity across the three partners, named next to the solar figure (review 2026-10-28).
  const otherBy = new Map<string, number>()
  for (const s of [degewo, bvg, bsw]) for (const o of s.other) otherBy.set(o.carrier, (otherBy.get(o.carrier) ?? 0) + o.kw)
  const otherSorted = [...otherBy.entries()].sort((a, b) => b[1] - a[1])
  const otherKw = otherSorted.reduce((a, [, kw]) => a + kw, 0)
  const list = (xs: [string, number][]) => xs.map(([c, kw]) => `${f.kw(kw)} ${f.carrier(c)}`).join(', ')

  const allPoints = d.stations.reduce((a, s) => a + s.points, 0)
  const bswPoints = d.stations.filter((s) => s.bsw).reduce((a, s) => a + s.points, 0)
  const cityShare = allPoints ? bswPoints / allPoints : 0

  stops.push({
    id: 'overview',
    lens: 'degewo',
    realism: false,
    camera: CITY,
    overlay: null,
    title: 'tour.overview.title',
    body: 'tour.overview.body',
    figureLabel: 'tour.overview.figure',
    params: {
      bsw: f.kw(bsw.kw),
      degewo: f.kw(degewo.kw),
      bvg: f.kw(bvg.kw),
      otherKw: f.kw(otherKw),
      otherList: otherSorted.map(([c]) => f.carrier(c)).join(', ') || '-',
      points: f.n(bswPoints),
    },
    figure: '3',
    badges: [],
    source: 'tour.src.mastrCharging',
  })

  const roofs = rankRoofs(d.sites.buildings)
  const hero = roofs[0]
  if (hero) {
    stops.push({
      id: 'hero',
      lens: 'degewo',
      realism: true,
      camera: { center: [hero.lon, hero.lat], ...SITE },
      overlay: null,
      title: 'tour.hero.title',
      body: 'tour.hero.body',
      figureLabel: 'tour.hero.figure',
      params: { addr: hero.addr, pot: f.n(Math.round(hero.potKw)), inst: f.n(Math.round(hero.installedKw)) },
      figure: `${f.n(Math.round(openKw(hero)))} kWp`,
      badges: ['estimate'],
      source: 'tour.src.atlas',
    })
  }

  // The named estate with the most open potential on its ranked roofs.
  const named = d.sites.estates.filter((e) => e.kind === 'named' && e.outline)
  const byEstate = named
    .map((e) => {
      // only roofs that still have something open: the caption says "still open"
      const mine = roofs.filter((r) => r.estates?.includes(e.id) && openKw(r) > 0)
      return { e, n: mine.length, open: mine.reduce((a, r) => a + openKw(r), 0) }
    })
    .sort((a, b) => b.open - a.open)
  const est = byEstate[0]
  const c = est && centroid(est.e.outline)
  if (est && c) {
    const claim = (est.e as Estate & { claim?: Record<string, string> }).claim?.[lang] ?? ''
    stops.push({
      id: 'estate',
      lens: 'degewo',
      realism: true,
      camera: { center: c, zoom: 15.4, pitch: 55, bearing: 25 },
      overlay: null,
      title: 'tour.estate.title',
      body: est.n ? 'tour.estate.body' : 'tour.estate.bodyNone',
      figureLabel: 'tour.estate.figure',
      params: { name: est.e.name, claim, n: f.n(est.n) },
      figure: `${f.n(Math.round(est.open))} kWp`,
      badges: ['estimate'],
      source: 'tour.src.atlas',
    })
  }

  const reach = estateReach(mergeNested(d.sites.estates), d.stations)
  const rs = reachSummary(reach, d.stations)
  const gaps = reach.filter((r) => r.bswGap).map((r) => shortName(r.name))
  stops.push({
    id: 'charging',
    lens: 'bsw',
    realism: false,
    camera: { ...CITY, pitch: 30, bearing: -10 },
    overlay: 'gap',
    title: 'tour.charging.title',
    body: rs.bswShare !== null && rs.bswShare < cityShare ? 'tour.charging.bodyBelow' : 'tour.charging.bodyAtLeast',
    figureLabel: 'tour.charging.figure',
    params: {
      estates: f.n(rs.estates),
      points: f.n(rs.points),
      bswPoints: f.n(rs.bswPoints),
      city: f.pct(cityShare),
      gaps: gaps.length ? gaps.join(', ') : '-',
      gapCount: f.n(gaps.length),
    },
    figure: rs.bswShare === null ? '-' : f.pct(rs.bswShare),
    badges: ['airline'],
    source: 'tour.src.charging',
  })

  const depot = d.sites.depots.filter((x) => x.lon !== null && x.status === 'operating').sort((a, b) => b.kwGross - a.kwGross)[0]
  if (depot && bvg.depots) {
    stops.push({
      id: 'bvg',
      lens: 'bvg',
      realism: true,
      camera: { center: [depot.lon!, depot.lat!], zoom: 16.4, pitch: 55, bearing: 30 },
      overlay: null,
      title: 'tour.bvg.title',
      body: 'tour.bvg.body',
      figureLabel: 'tour.bvg.figure',
      params: {
        sites: f.n(bvg.depots.total),
        building: f.n(bvg.depots.construction),
        deal: f.n(bvg.depots.deal2025),
        name: depot.name,
        kw: f.n(Math.round(depot.kwGross)),
        units: f.n(bvg.units),
      },
      figure: f.kw(bvg.kw),
      badges: [],
      source: 'tour.src.mastrDepots',
    })
  }

  stops.push({
    id: 'bsw',
    lens: 'bsw',
    realism: false,
    camera: { ...CITY, pitch: 40, bearing: -15 },
    overlay: null,
    title: 'tour.bsw.title',
    body: 'tour.bsw.body',
    figureLabel: 'tour.bsw.figure',
    params: {
      units: f.n(bsw.units),
      mieterstrom: f.n(bsw.mieterstrom),
      postcodeOnly: f.n(bsw.postcodeOnly),
      others: list(bsw.other.map((o) => [o.carrier, o.kw])) || '-',
      points: f.n(bswPoints),
      city: f.pct(cityShare),
    },
    figure: f.kw(bsw.kw),
    badges: bsw.postcodeOnly ? ['aggregated'] : [],
    source: 'tour.src.mastrCharging',
  })

  stops.push({
    id: 'close',
    lens: 'degewo',
    realism: false,
    camera: { ...CITY, zoom: 10.1, pitch: 50, bearing: 20 },
    overlay: null,
    title: 'tour.close.title',
    body: 'tour.close.body',
    figureLabel: 'tour.close.figure',
    params: {
      roofs: f.n(degewo.roofs?.count ?? 0),
      building: f.n(bvg.depots?.construction ?? 0),
      gapCount: f.n(gaps.length),
      estates: f.n(rs.estates),
    },
    figure: f.kw(degewo.roofs?.openKw ?? 0),
    badges: ['estimate'],
    source: 'tour.src.atlas',
  })

  return stops
}
