import { describe, expect, it } from 'vitest'
import { classify, estimateKw, parseIrradiance, STALE_MS } from '../solarNow'

const answer = (solar10: number | null, ts = '2026-06-21T13:00:00+02:00') => ({
  weather: { timestamp: ts, solar_10: solar10, source_id: 7 },
  sources: [{ id: 7, station_name: 'Berlin-Tempelhof' }],
})
const noon = new Date('2026-06-21T13:05:00+02:00')
const midnight = new Date('2026-06-21T00:30:00+02:00')

describe('solar output now (D56)', () => {
  it('turns kWh/m² per 10 min into W/m²', () => {
    expect(parseIrradiance(answer(0.12))).toMatchObject({ wm2: 720, station: 'Berlin-Tempelhof' })
    expect(parseIrradiance(answer(null))?.wm2).toBeNull()
    expect(parseIrradiance({})).toBeNull()
  })

  it('names the station the irradiance really comes from (fallback, not Tempelhof)', () => {
    const d = {
      weather: { timestamp: '2026-06-21T13:00:00+02:00', solar_10: 0.1, source_id: 1, fallback_source_ids: { solar_10: 2 } },
      sources: [{ id: 1, station_name: 'Berlin-Tempelhof' }, { id: 2, station_name: 'Potsdam' }],
    }
    expect(parseIrradiance(d)?.station).toBe('Potsdam')
  })

  it('estimates GHI × kWp × PR', () => {
    expect(estimateKw(1000, 100)).toBeCloseTo(80)
    expect(estimateKw(500, 19_400)).toBeCloseTo(7760)
  })

  it('says night or missing instead of showing 0 kW as a reading', () => {
    expect(classify(parseIrradiance(answer(0, '2026-06-21T00:20:00+02:00')), midnight).kind).toBe('night')
    expect(classify(parseIrradiance(answer(null)), noon).kind).toBe('missing')
    expect(classify(null, noon).kind).toBe('missing')
  })

  it('marks a value older than 90 minutes as stale', () => {
    const i = parseIrradiance(answer(0.1))!
    expect(classify(i, noon)).toMatchObject({ kind: 'ok', stale: false })
    expect(classify(i, new Date(i.at.getTime() + STALE_MS + 60_000))).toMatchObject({ kind: 'ok', stale: true })
  })
})
