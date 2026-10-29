/**
 * The guided tour (PLAN §5, Phase 4; decided 2026-10-28; five stops D54, ten
 * stops with the new features D62, 2026-10-29): the presenter clicks Next, the
 * camera flies and holds still, a caption card at the bottom says what is on
 * screen. Story: who > what the sun gives now > charging per district > charging
 * at the estates > the largest open roof at true size > an estate's roofs > BVG
 * depot solar > BVG live > the same figures in Power BI > today and next.
 *
 * Every number in a caption is computed here from the baked files, never typed
 * into a string, so the tour cannot drift from the lenses or the report. The
 * stops pick their subject from the data too (the largest open roof, the named
 * estate with most open potential, the largest BVG site), so a re-bake keeps
 * the story true. Two stops show LIVE figures (solar now, vehicles on the map):
 * their `figure` is filled by the app at render time, marked by `live`.
 */
import type { Station } from '../charging/charging'
import type { DistrictStats } from '../charging/districts'
import type { StringKey } from '../i18n/strings'
import { estateReach, mergeNested, reachSummary, type EstateReach } from '../partners/chargingGap'
import { lensSummary, openKw, rankRoofs, type Estate, type Lens, type SitesData, type Unit } from '../partners/partners'

export type TourCamera = { center: [number, number]; zoom: number; pitch: number; bearing: number }
export type Badge = 'estimate' | 'aggregated' | 'airline' | 'unofficial'

export type TourStop = {
  id: 'overview' | 'now' | 'districts' | 'charging' | 'hero' | 'roofs' | 'bvg' | 'live' | 'report' | 'close'
  lens: Lens
  /** buildings and aerial photo on (D26) */
  realism: boolean
  camera: TourCamera
  /** the charging-gap outlines, or the districts shaded by charge points per 1,000 residents */
  overlay: 'gap' | 'districts' | null
  /** BVG vehicles on the map at this stop */
  bvgLive?: boolean
  /** opens the report window on this page */
  report?: 'stadtwerke' | 'degewo' | 'bvg' | 'laden'
  /** the figure is live and filled by the app: the solar estimate or the vehicle count */
  live?: 'solar' | 'vehicles'
  title: StringKey
  body: StringKey
  figureLabel: StringKey
  /** filled into title, body and figure label */
  params: Record<string, string>
  figure: string
  badges: Badge[]
  source: StringKey
}

export type TourData = {
  units: readonly Unit[]
  sites: SitesData
  stations: readonly Station[]
  /** charging per district (D61); without it the district stop is left out */
  districts?: readonly DistrictStats[] | null
  /** a published report is configured; without it the report stop is left out */
  hasReport?: boolean
}
export type TourFormat = {
  n: (v: number) => string
  kw: (v: number) => string
  pct: (share: number) => string
  carrier: (c: string) => string
  dec1: (v: number) => string
}

/** The story order (D62); a stop whose data is missing is skipped, the rest keep their order. */
export const STORY: TourStop['id'][] = ['overview', 'now', 'districts', 'charging', 'hero', 'roofs', 'bvg', 'live', 'report', 'close']

/** MaStR carriers the partners' register queries return; each has a `carrier.<name>` string. */
export const CARRIERS = ['Solare Strahlungsenergie', 'Wind', 'Erdgas', 'andere Gase', 'Speicher', 'Biomasse']

/** Berlin as a whole, centred ~5 km south so the city sits above the caption card. */
const CITY: TourCamera = { center: [13.405, 52.455], zoom: 9.9, pitch: 35, bearing: 0 }
/** One building fills the middle (as the list clicks, SITE_VIEW in App). */
const SITE = { zoom: 17.2, pitch: 58, bearing: -20 }
/** Mitte at street level: dense enough that buses and trams show at any hour. */
const MITTE: TourCamera = { center: [13.4094, 52.5208], zoom: 14.3, pitch: 45, bearing: 20 }

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

  // D54: the largest open roof and the estate with most open potential are ONE
  // stop. The camera shows the estate (several roofs, each with its number);
  // the caption names the single largest roof as well.
  const roofs = rankRoofs(d.sites.buildings)
  const hero = roofs[0]
  const named = d.sites.estates.filter((e) => e.kind === 'named' && e.outline)
  const byEstate = named
    .map((e) => {
      // only roofs that still have something open: the caption says "still open"
      const mine = roofs.filter((r) => r.estates?.includes(e.id) && openKw(r) > 0)
      return { e, n: mine.length, open: mine.reduce((a, r) => a + openKw(r), 0), mine }
    })
    .sort((a, b) => b.open - a.open)
  const est = byEstate[0]
  // Aim at the open roofs themselves, not the estate's centre: in Gropiusstadt they sit
  // about 600 m east of it, and the first cut of this stop framed none of them.
  const c: [number, number] | null = est?.mine.length
    ? [est.mine.reduce((a, r) => a + r.lon, 0) / est.mine.length, est.mine.reduce((a, r) => a + r.lat, 0) / est.mine.length]
    : est
      ? centroid(est.e.outline)
      : null
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
  if (hero && est && c) {
    const claim = (est.e as Estate & { claim?: Record<string, string> }).claim?.[lang] ?? ''
    stops.push({
      id: 'roofs',
      lens: 'degewo',
      realism: true,
      camera: { center: c, zoom: 16, pitch: 55, bearing: 25 },
      overlay: null,
      title: 'tour.roofs.title',
      body: est.n ? 'tour.roofs.body' : 'tour.roofs.bodyNone',
      figureLabel: 'tour.roofs.figure',
      params: { name: est.e.name, claim: claim || ' ', n: f.n(est.n), addr: hero.addr, heroOpen: f.n(Math.round(openKw(hero))) },
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

  // D54: "the Stadtwerke today" and "what comes next" close the tour as one stop on the city.
  stops.push({
    id: 'close',
    lens: 'bsw',
    realism: false,
    camera: { ...CITY, zoom: 10.1, pitch: 45, bearing: 15 },
    overlay: null,
    title: 'tour.close.title',
    body: 'tour.close.body',
    figureLabel: 'tour.close.figure',
    params: {
      units: f.n(bsw.units),
      mieterstrom: f.n(bsw.mieterstrom),
      postcodeOnly: f.n(bsw.postcodeOnly),
      points: f.n(bswPoints),
      city: f.pct(cityShare),
      roofs: f.n(degewo.roofs?.count ?? 0),
      open: f.kw(degewo.roofs?.openKw ?? 0),
      building: f.n(bvg.depots?.construction ?? 0),
      gapCount: f.n(gaps.length),
      estates: f.n(rs.estates),
    },
    figure: f.kw(bsw.kw),
    badges: bsw.postcodeOnly ? ['estimate', 'aggregated'] : ['estimate'],
    source: 'tour.src.mastrCharging',
  })

  // D62: what the sun gives right now. The figure is LIVE (filled by the app).
  stops.push({
    id: 'now',
    lens: 'bsw',
    realism: false,
    camera: { ...CITY, zoom: 10.2, pitch: 20, bearing: 0 },
    overlay: null,
    live: 'solar',
    title: 'tour.now.title',
    body: 'tour.now.body',
    figureLabel: 'tour.now.figure',
    params: { mw: f.kw(bsw.kw) },
    figure: '…',
    badges: ['estimate'],
    source: 'tour.src.dwd',
  })

  // D62: charging per district, from the same stations as every other figure.
  if (d.districts?.length) {
    const ds = [...d.districts].sort((a, b) => b.per1000 - a.per1000)
    const top = ds[0]
    const low = ds[ds.length - 1]
    const residents = ds.reduce((a, x) => a + x.residents, 0)
    const pts = ds.reduce((a, x) => a + x.points, 0)
    stops.push({
      id: 'districts',
      lens: 'bsw',
      realism: false,
      camera: { ...CITY, pitch: 20, bearing: 0 },
      overlay: 'districts',
      title: 'tour.districts.title',
      body: 'tour.districts.body',
      figureLabel: 'tour.districts.figure',
      params: { top: top.bez, topV: f.dec1(top.per1000), low: low.bez, lowV: f.dec1(low.per1000), points: f.n(pts) },
      figure: f.dec1(residents ? (pts / residents) * 1000 : 0),
      badges: [],
      source: 'tour.src.districts',
    })
  }

  // D62: BVG live in Mitte. The figure (vehicles on the map) is LIVE.
  stops.push({
    id: 'live',
    lens: 'bvg',
    realism: false,
    camera: MITTE,
    overlay: null,
    bvgLive: true,
    live: 'vehicles',
    title: 'tour.live.title',
    body: 'tour.live.body',
    figureLabel: 'tour.live.figure',
    params: {},
    figure: '…',
    badges: ['unofficial'],
    source: 'tour.src.radar',
  })

  // D62: the same figures in the published Power BI report (only when one is configured).
  if (d.hasReport) {
    stops.push({
      id: 'report',
      lens: 'bsw',
      realism: false,
      camera: { ...CITY, zoom: 10, pitch: 0, bearing: 0 },
      overlay: null,
      report: 'stadtwerke',
      title: 'tour.report.title',
      body: 'tour.report.body',
      figureLabel: 'tour.report.figure',
      params: { mw: f.kw(bsw.kw) },
      figure: f.kw(bsw.kw),
      badges: [],
      source: 'tour.src.report',
    })
  }

  return STORY.flatMap((id) => stops.filter((s) => s.id === id))
}

/**
 * Flight time between two stops (D54): a hop inside one district is quick, a
 * flight across the city takes longer, so no leg feels rushed or sluggish.
 */
export function flightMs(from: TourCamera | null, to: TourCamera): number {
  if (!from) return 3000
  const kx = 111.32 * Math.cos((to.center[1] * Math.PI) / 180)
  const km = Math.hypot((to.center[0] - from.center[0]) * kx, (to.center[1] - from.center[1]) * 110.54)
  const ms = 2200 + 520 * Math.log2(1 + km) + 220 * Math.abs(to.zoom - from.zoom)
  return Math.round(Math.min(5200, Math.max(2200, ms)))
}
