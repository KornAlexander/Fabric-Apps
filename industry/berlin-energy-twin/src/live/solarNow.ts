import { useEffect, useState } from 'react'

import { sunPosition } from '../scene/sun'

/**
 * Solar output now, estimated (PLAN §4 analysis 3, D56).
 *
 * Bright Sky `current_weather` near Berlin-Tempelhof gives `solar_10`: global
 * horizontal irradiation in kWh/m² over the last 10 minutes. ⚠️ Tempelhof (DWD
 * 00433) measures no radiation: Bright Sky fills `solar_10` from a fallback
 * station, measured 2026-10-29 as Potsdam (DWD 03987, about 25 km). The KPI names
 * the station the value really comes from (`fallback_source_ids.solar_10`).
 * Times 6 is kWh/m² per hour, i.e. kW/m², times 1000 the irradiance in W/m².
 *
 *   estimate kW = GHI / 1000 W/m² × installed kWp × PR
 *
 * A flat-plate equivalent: real roofs tilt and face differently, so this is an
 * order of magnitude, badged "Schätzung" with station and observation time.
 * PR (performance ratio) 0.8: Fraunhofer ISE "Aktuelle Fakten zur Photovoltaik"
 * gives 80 to 90 % for new plants; the lower end allows for older ones.
 *
 * ⚠️ Night or a missing value is "keine Messung", never 0 kW presented as a
 * reading; a feed older than 90 minutes keeps its last value with its age.
 */
export const BRIGHTSKY_URL = 'https://api.brightsky.dev/current_weather?lat=52.4675&lon=13.4021&tz=Europe/Berlin'
export const PERFORMANCE_RATIO = 0.8
export const STALE_MS = 90 * 60_000
export const POLL_SOLAR_MS = 10 * 60_000
const TEMPELHOF = { lat: 52.4675, lon: 13.4021 }

export type Irradiance = { wm2: number | null; at: Date; station: string }
export type SolarNow =
  | { kind: 'loading' }
  | { kind: 'night'; at: Date; station: string }
  | { kind: 'missing'; at: Date | null; station: string }
  | { kind: 'ok'; wm2: number; at: Date; station: string; stale: boolean }

export function parseIrradiance(json: unknown): Irradiance | null {
  const d = json as {
    weather?: { timestamp?: string; solar_10?: number | null; source_id?: number; fallback_source_ids?: Record<string, number> }
    sources?: { id?: number; station_name?: string }[]
  }
  const w = d?.weather
  if (!w?.timestamp) return null
  const at = new Date(w.timestamp)
  if (Number.isNaN(at.getTime())) return null
  const sourceId = w.fallback_source_ids?.solar_10 ?? w.source_id
  const station = d.sources?.find((s) => s.id === sourceId)?.station_name ?? 'DWD'
  const wm2 = typeof w.solar_10 === 'number' && Number.isFinite(w.solar_10) ? Math.max(0, w.solar_10 * 6 * 1000) : null
  return { wm2, at, station }
}

export function classify(i: Irradiance | null, now: Date): SolarNow {
  if (!i) return { kind: 'missing', at: null, station: 'DWD' }
  if (sunPosition(now, TEMPELHOF.lat, TEMPELHOF.lon).elevation <= 0) return { kind: 'night', at: i.at, station: i.station }
  if (i.wm2 === null) return { kind: 'missing', at: i.at, station: i.station }
  return { kind: 'ok', wm2: i.wm2, at: i.at, station: i.station, stale: now.getTime() - i.at.getTime() > STALE_MS }
}

export function estimateKw(wm2: number, kwp: number, pr = PERFORMANCE_RATIO): number {
  return (wm2 / 1000) * kwp * pr
}

/** Polls every 10 min while the page is visible; a failed fetch keeps the last good value (it then ages into "stale"). */
export function useSolarNow(clock: Date): SolarNow {
  const [irr, setIrr] = useState<Irradiance | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (!document.hidden) {
        try {
          const r = await fetch(BRIGHTSKY_URL)
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          const i = parseIrradiance(await r.json())
          if (alive) setIrr((prev) => i ?? prev ?? null)
        } catch (e) {
          console.warn('solar now unavailable', e)
          if (alive) setIrr((prev) => prev ?? null)
        }
      }
      if (alive) timer = setTimeout(poll, POLL_SOLAR_MS)
    }
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer)
        void poll()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    void poll()
    return () => {
      alive = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  if (irr === undefined) return { kind: 'loading' }
  return classify(irr, clock)
}
