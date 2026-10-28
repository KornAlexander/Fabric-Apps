/**
 * Export the baked twin data as the tables of the import semantic model
 * (fabric/gen_model.py), one semicolon CSV per table in fabric/build/.
 *
 * Runs on the APP's own functions (lensSummary rules, mergeNested, estateReach,
 * distanceToOutline, openKw), so every figure the model can show agrees with
 * the app by construction. `npm run export:model`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Station } from '../src/charging/charging'
import { distanceToOutline, estateReach, GAP_RADII_M, mergeNested } from '../src/partners/chargingGap'
import { openKw, roofShare, SOLAR, type Estate, type SitesData, type Unit } from '../src/partners/partners'

const OUT = 'fabric/build'
const read = (f: string) => JSON.parse(readFileSync(`public/data/${f}`, 'utf-8'))

type Poly = Estate['outline']
type FullUnit = Unit & { kwNet: number | null; kwhStorage: number | null; city: string | null; street: string | null; no: string | null; siteKind: string | null; feedIn: string | null }
type District = { id: number; bez: string; residents: number; lon: number; lat: number; outline: Poly }
type ChargingDistrict = { bez: string; allPoints: number; allPointsKw: number; pointsAsOf: string; publicKwhByYear: Record<string, number> }
type ContextBuilding = { id: number; lon: number; lat: number; potKw: number; areaM2: number; fn: string | null; estate: string }

const unitsFile = read('units.json')
const units = unitsFile.units as FullUnit[]
const sites = read('sites.json') as SitesData & { meta: Record<string, string>; context: ContextBuilding[]; estates: (Estate & { bezirk?: string | null; source?: string })[] }
const charging = read('charging.json')
const stations = charging.stations as Station[]
const chargingDistricts = charging.districts as ChargingDistrict[]
const context = read('context.json')
const districts = context.districts as District[]
const estateResidents = context.estateResidents as Record<string, number>
const roofHeights = read('roofs.json').roofs as Record<string, { groundM: number; roofM: number }>

// --- lookups -------------------------------------------------------------------

const PARTNER: Record<string, [string, string, number]> = {
  bsw: ['Berliner Stadtwerke', 'Energieversorger des Landes Berlin', 1],
  degewo: ['degewo', 'Wohnungsbaugesellschaft des Landes Berlin', 2],
  bvg: ['BVG', 'Verkehrsbetrieb des Landes Berlin', 3],
}
const CARRIER: Record<string, string> = {
  [SOLAR]: 'Solar',
  Wind: 'Wind',
  Erdgas: 'Erdgas',
  'andere Gase': 'andere Gase',
  Speicher: 'Speicher',
  Biomasse: 'Biomasse',
}
const PLACEMENT: Record<string, string> = {
  register: 'Registerkoordinaten',
  address: 'Adresse im Solarkataster',
  'address-osm': 'Adresse in OpenStreetMap',
  depot: 'Betriebshof',
  postcode: 'nur Postleitzahl',
}
const DEPOT_KIND: Record<string, string> = {
  site: 'Standort',
  bus: 'Busbetriebshof',
  ebus: 'E-Bus-Betriebshof',
  'bus+tram': 'Bus- und Straßenbahnbetriebshof',
  tram: 'Straßenbahnbetriebshof',
  metro: 'U-Bahn-Betriebshof',
}
const yn = (b: unknown) => (b ? 'ja' : 'nein')

/** District whose outline holds the point; the nearest one for a point just outside (river, border). */
function bezirkAt(lon: number | null | undefined, lat: number | null | undefined): string | null {
  if (lon == null || lat == null) return null
  let best: string | null = null
  let bestD = Infinity
  for (const d of districts) {
    const dist = distanceToOutline(lon, lat, d.outline)
    if (dist < bestD) {
      bestD = dist
      best = d.bez
    }
  }
  return bestD < 2000 ? best : null
}
const plzCentre = new Map(sites.postcodes.map((p) => [p.plz, [p.lon, p.lat] as const]))
/** Bezirk most charging stations of a postcode lie in, for units known by postcode only and outside sites.postcodes. */
const plzBezirk = new Map<string, string>()
{
  const votes = new Map<string, Map<string, number>>()
  for (const s of charging.stations as Station[]) {
    if (!s.plz || !s.bez) continue
    const v = votes.get(s.plz) ?? new Map<string, number>()
    v.set(s.bez, (v.get(s.bez) ?? 0) + 1)
    votes.set(s.plz, v)
  }
  for (const [plz, v] of votes) plzBezirk.set(plz, [...v.entries()].sort((a, b) => b[1] - a[1])[0][0])
}
function centroidOf(outline: Poly): [number, number] | null {
  if (!outline) return null
  const ring = (outline.type === 'Polygon' ? (outline.coordinates as number[][][])[0] : (outline.coordinates as number[][][][])[0][0]) ?? []
  if (!ring.length) return null
  return [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length]
}

// --- CSV -----------------------------------------------------------------------

type Cell = string | number | null | undefined
const tables: Record<string, number> = {}
function write(name: string, header: string[], rows: Cell[][]): void {
  const cell = (v: Cell) => {
    if (v == null) return ''
    if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : ''
    return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }
  for (const r of rows) if (r.length !== header.length) throw new Error(`${name}: row width ${r.length} != ${header.length}`)
  writeFileSync(`${OUT}/${name}.csv`, [header, ...rows].map((r) => r.map(cell).join(';')).join('\n') + '\n', 'utf-8')
  tables[name] = rows.length
}
mkdirSync(OUT, { recursive: true })

// --- Partner -------------------------------------------------------------------

write(
  'Partner',
  ['Partner-Schlüssel', 'Partner', 'Rolle', 'Partner-Sortierung'],
  Object.entries(PARTNER).map(([k, [name, role, order]]) => [k, name, role, order]),
)

// --- Bezirk and Ladestrom ------------------------------------------------------

const chargingByBez = new Map(chargingDistricts.map((c) => [c.bez, c]))
write(
  'Bezirk',
  ['Bezirk-Nr', 'Bezirk', 'Einwohner', 'Ladepunkte Register gesamt', 'Ladeleistung Register gesamt kW', 'Stand Ladepunkte Register', 'Längengrad', 'Breitengrad'],
  districts.map((d) => {
    const c = chargingByBez.get(d.bez)
    return [d.id, d.bez, d.residents, c?.allPoints, c?.allPointsKw, c?.pointsAsOf, d.lon, d.lat]
  }),
)
for (const c of chargingDistricts) if (!districts.some((d) => d.bez === c.bez)) throw new Error(`charging district ${c.bez} not in context.json`)

write(
  'Ladestrom',
  ['Bezirk', 'Jahr', 'Ladestrom öffentlich kWh'],
  chargingDistricts.flatMap((c) => Object.entries(c.publicKwhByYear).map(([y, kwh]) => [c.bez, Number(y), kwh])),
)

// --- Anlage (MaStR units) ------------------------------------------------------

const depotName = new Map(sites.depots.map((d) => [d.id, d.name]))
write(
  'Anlage',
  [
    'MaStR-Nummer', 'Anlagenname', 'Partner-Schlüssel', 'Betreiber', 'Energieträger', 'Energieträger MaStR', 'Bruttoleistung kW', 'Nettoleistung kW',
    'Speicherkapazität kWh', 'Betriebsstatus', 'Inbetriebnahme', 'Inbetriebnahmejahr', 'PLZ', 'Ort', 'Straße', 'Hausnummer', 'Mieterstrom',
    'Anlagenart', 'Einspeiseart', 'Verortung', 'Genau verortet', 'Betriebshof', 'Bezirk', 'Längengrad', 'Breitengrad',
  ],
  units.map((u) => {
    if (u.queries.length !== 1) throw new Error(`${u.id}: ${u.queries.length} partners; the model expects exactly one`)
    if (!(u.carrier in CARRIER)) throw new Error(`${u.id}: unknown carrier ${u.carrier}`)
    const p = sites.placements[u.id]
    const exact = p && p.method !== 'postcode'
    const pc = u.plz ? plzCentre.get(u.plz) : undefined
    const lon = exact ? p.lon : pc?.[0]
    const lat = exact ? p.lat : pc?.[1]
    const depot = p?.depot ? depotName.get(p.depot) ?? null : null
    return [
      u.id, u.name, u.queries[0], u.operator, CARRIER[u.carrier], u.carrier, u.kwGross, u.kwNet,
      u.kwhStorage, u.status, u.commissioned, u.commissioned ? Number(u.commissioned.slice(0, 4)) : null, u.plz, u.city, u.street, u.no, yn(u.mieterstrom),
      u.siteKind, u.feedIn, p ? PLACEMENT[p.method] : 'unbekannt', yn(exact), depot, bezirkAt(lon, lat) ?? (u.plz ? plzBezirk.get(u.plz) : null) ?? null, exact ? lon : null, exact ? lat : null,
    ]
  }),
)

// --- Ladestation ---------------------------------------------------------------

const ladeRows = stations.map((s) => {
  if (s.bez && !districts.some((d) => d.bez === s.bez)) throw new Error(`station ${s.id}: unknown Bezirk ${s.bez}`)
  const cls = s.kw == null ? 'unbekannt' : s.kw >= 150 ? 'ab 150 kW' : s.kw > 22 ? '23 bis 149 kW' : 'bis 22 kW'
  return [s.id, s.op, yn(s.bsw), s.addr, s.plz, s.bez ?? bezirkAt(s.lon, s.lat), s.points, s.kw, cls, yn(s.dc), s.year, yn(s.public), s.lon, s.lat]
})
write(
  'Ladestation',
  ['Ladestation-ID', 'Betreiber', 'Stadtwerke', 'Adresse', 'PLZ', 'Bezirk', 'Ladepunkte', 'Höchstleistung kW', 'Leistungsklasse', 'Schnellladen DC', 'Inbetriebnahmejahr', 'Im öffentlichen Straßenland', 'Längengrad', 'Breitengrad'],
  ladeRows,
)

// --- Quartier and charging around it ---------------------------------------------

const merged = mergeNested(sites.estates)
const mergedIds = new Set(merged.map((e) => e.id))
const reach = new Map(estateReach(merged, stations).map((r) => [r.id, r]))
const named = sites.estates.filter((e) => e.kind === 'named' && e.outline)
write(
  'Quartier',
  [
    'Quartier-ID', 'Quartier', 'Quartiersart', 'Bezirk', 'Einwohner', 'Eigenständiges Quartier', 'Teil von', 'Quelle',
    'Ladestationen bis 300 m', 'Ladepunkte bis 300 m', 'Stadtwerke-Ladepunkte bis 300 m', 'Stadtwerke-Ladelücke 300 m',
    'Ladepunkte bis 500 m', 'Stadtwerke-Ladepunkte bis 500 m', 'Längengrad', 'Breitengrad',
  ],
  sites.estates.map((e) => {
    const c = centroidOf(e.outline)
    const own = mergedIds.has(e.id)
    const parent = own ? null : named.find((n) => c && distanceToOutline(c[0], c[1], n.outline) === 0)?.name ?? null
    const r = reach.get(e.id)
    const src = e.source ? (sites.sources as Record<string, string>)[e.source] ?? e.source : null
    return [
      e.id, e.name, e.kind === 'named' ? 'benanntes Quartier' : 'Cluster nach Postleitzahl', e.bezirk ?? (c ? bezirkAt(c[0], c[1]) : null), estateResidents[e.id],
      yn(own), parent, src,
      r?.within[300].stations, r?.within[300].points, r?.within[300].bswPoints, r ? yn(r.bswGap) : null,
      r?.within[500].points, r?.within[500].bswPoints, c?.[0], c?.[1],
    ]
  }),
)

// Station x estate within the largest radius, straight-line distance to the outline (0 inside).
// The radius flags come from estateReach itself: a rounded distance would let a
// station at 300.4 m count as "bis 300 m" (466 instead of the app's 464 points).
const maxR = Math.max(...GAP_RADII_M) as (typeof GAP_RADII_M)[number]
const stationById = new Map(stations.map((s) => [s.id, s]))
const near: Cell[][] = []
for (const e of merged) {
  const r = reach.get(e.id)
  if (!r || !e.outline) continue
  const in300 = new Set(r.within[300].ids)
  for (const id of r.within[maxR].ids) {
    const s = stationById.get(id)!
    near.push([e.id, id, Math.round(distanceToOutline(s.lon, s.lat, e.outline) * 10) / 10, yn(in300.has(id))])
  }
}
write('Quartier Ladestation', ['Quartier-ID', 'Ladestation-ID', 'Abstand m', 'Bis 300 m'], near)

// --- Betriebshof ---------------------------------------------------------------

write(
  'Betriebshof',
  ['Betriebshof-ID', 'Betriebshof', 'Art', 'Status', 'Solarvereinbarung 2025', 'Solarleistung kWp', 'Solaranlagen', 'Bezirk', 'Quelle', 'Längengrad', 'Breitengrad'],
  sites.depots.map((d) => [
    d.id, d.name, DEPOT_KIND[d.kind] ?? d.kind, d.status === 'operating' ? 'in Betrieb' : 'im Bau', yn(d.deal2025), d.kwGross, d.units.length,
    bezirkAt(d.lon, d.lat) ?? (centroidOf(d.outline ?? null) ? bezirkAt(...centroidOf(d.outline ?? null)!) : null) ??
      // a site without a position: the postcode of its register units (Alt-Moabit, 10555)
      d.units.map((id) => units.find((x) => x.id === id)?.plz).map((plz) => (plz ? plzBezirk.get(plz) : undefined)).find(Boolean) ?? null,
    (sites.sources as Record<string, string>)[d.source] ?? d.source, d.lon, d.lat,
  ]),
)

// --- Fokusdach and Gebäude im Quartier -------------------------------------------

const estateName = new Map(sites.estates.map((e) => [e.id, e.name]))
write(
  'Fokusdach',
  [
    'Gebäude-ID', 'Adresse', 'Gebäudefunktion', 'Dachfläche m²', 'Solarpotenzial kWp', 'Installiert kWp', 'Offenes Potenzial kWp', 'Ausschöpfung',
    'Anlagen auf dem Dach', 'Quartier-ID', 'Quartier', 'Bezirk', 'Gebäudehöhe m', 'Geländehöhe m', 'Längengrad', 'Breitengrad',
  ],
  sites.buildings.map((b) => {
    const h = roofHeights[String(b.id)]
    const est = b.estates?.[0] ?? null
    return [
      b.id, b.addr, b.fn, b.areaM2, b.potKw, b.installedKw, openKw(b), roofShare(b),
      b.units.length, est, est ? estateName.get(est) : null, bezirkAt(b.lon, b.lat), h?.roofM, h?.groundM, b.lon, b.lat,
    ]
  }),
)

write(
  'Gebäude im Quartier',
  ['Gebäude-ID', 'Quartier-ID', 'Gebäudefunktion', 'Dachfläche m²', 'Solarpotenzial kWp', 'Längengrad', 'Breitengrad'],
  sites.context.map((b) => [b.id, b.estate, b.fn, b.areaM2, b.potKw, b.lon, b.lat]),
)

// --- Jahr ----------------------------------------------------------------------

const years = [
  ...units.map((u) => (u.commissioned ? Number(u.commissioned.slice(0, 4)) : NaN)),
  ...stations.map((s) => s.year ?? NaN),
  ...chargingDistricts.flatMap((c) => Object.keys(c.publicKwhByYear).map(Number)),
].filter(Number.isFinite)
const y0 = Math.min(...years)
const y1 = Math.max(...years)
write('Jahr', ['Jahr', 'Jahrzehnt'], Array.from({ length: y1 - y0 + 1 }, (_, i) => [y0 + i, `${Math.floor((y0 + i) / 10) * 10}er`]))

// --- Datenquelle ---------------------------------------------------------------

const metas: [string, Record<string, string>][] = [
  ['Anlage, Betriebshof (Solarleistung)', unitsFile.meta],
  ['Ladestation, Ladestrom, Bezirk (Ladepunkte)', charging.meta],
  ['Quartier, Betriebshof, Fokusdach, Gebäude im Quartier', sites.meta],
  ['Bezirk (Einwohner), Quartier (Einwohner)', context.meta],
]
write(
  'Datenquelle',
  ['Tabellen', 'Quelle', 'Namensnennung', 'Lizenz', 'Lizenz-URL', 'Stand'],
  metas.map(([t, m]) => [t, m.source, m.attribution, m.licence, m.url, m.bakedUtc?.slice(0, 10)]),
)

// --- expected figures for the agreement check (fabric/check_model.py) ---------------

const solar = units.filter((u) => u.carrier === SOLAR)
const kwOf = (xs: FullUnit[]) => xs.reduce((a, u) => a + (u.kwGross ?? 0), 0)
const nearIds = (r: number) => new Set(near.filter((n) => (r === 300 ? n[3] === 'ja' : true)).map((n) => n[1] as string))
const pointsOf = (ids: Set<string>, bswOnly = false) => stations.filter((s) => ids.has(s.id) && (!bswOnly || s.bsw)).reduce((a, s) => a + s.points, 0)
const expected = {
  solarKwp: Object.fromEntries(Object.keys(PARTNER).map((p) => [p, kwOf(solar.filter((u) => u.queries[0] === p))])),
  solarUnits: Object.fromEntries(Object.keys(PARTNER).map((p) => [p, solar.filter((u) => u.queries[0] === p).length])),
  otherKw: kwOf(units) - kwOf(solar),
  chargingPoints: stations.reduce((a, s) => a + s.points, 0),
  bswChargingPoints: stations.filter((s) => s.bsw).reduce((a, s) => a + s.points, 0),
  estates: merged.filter((e) => e.outline).length,
  pointsNear300: pointsOf(nearIds(300)),
  bswPointsNear300: pointsOf(nearIds(300), true),
  bswGaps300: [...reach.values()].filter((r) => r.bswGap).map((r) => r.name),
  focusRoofOpenKwp: sites.buildings.reduce((a, b) => a + openKw(b), 0),
  depots: sites.depots.length,
  residents: districts.reduce((a, d) => a + d.residents, 0),
}
writeFileSync(`${OUT}/expected.json`, JSON.stringify(expected, null, 1), 'utf-8')
console.log(JSON.stringify({ tables, expected }, null, 1))
