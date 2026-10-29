import { useEffect, useRef, useState } from 'react'

import { backoffMs, clampToBerlin, parseRadar, POLL_MS, radarUrl, type Bbox, type Vehicle } from './bvgRadar'

export type BvgLive =
  | { kind: 'off' }
  | { kind: 'loading' }
  | { kind: 'ok'; vehicles: Vehicle[]; capped: boolean; at: Date }
  | { kind: 'error'; detail: string }

/**
 * Polls the radar for the current camera view while `enabled` (D55): every 30 s,
 * again shortly after the camera stops moving, paused while the browser tab is
 * hidden. A 429 or a failed answer backs off (30 s, 60 s ... 5 min); after two
 * failures in a row the layer hides and the panel says why, never synthetic vehicles.
 */
export function useBvgLive(enabled: boolean, view: Bbox | null): BvgLive {
  const [state, setState] = useState<BvgLive>({ kind: 'off' })
  const viewRef = useRef(view)
  viewRef.current = view
  const failures = useRef(0)
  const kick = useRef<() => void>(() => {})

  useEffect(() => {
    if (!enabled) {
      setState({ kind: 'off' })
      return
    }
    let alive = true
    failures.current = 0
    let kickPending = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let ctrl: AbortController | null = null
    setState((s) => (s.kind === 'ok' ? s : { kind: 'loading' }))

    const schedule = (ms: number) => {
      clearTimeout(timer)
      timer = setTimeout(poll, ms)
    }
    const poll = async () => {
      if (!alive) return
      if (typeof document !== 'undefined' && document.hidden) return schedule(POLL_MS)
      const v = viewRef.current
      if (!v) return schedule(1000)
      ctrl?.abort()
      ctrl = new AbortController()
      inFlight = true
      try {
        const r = await fetch(radarUrl(clampToBerlin(v)), { signal: ctrl.signal })
        if (!r.ok) throw new Error(r.status === 429 ? 'rate limit (429)' : `HTTP ${r.status}`)
        const res = parseRadar(await r.json())
        if (!alive) return
        failures.current = 0
        setState({ kind: 'ok', vehicles: res.vehicles, capped: res.capped, at: new Date() })
        schedule(kickPending ? 1500 : POLL_MS)
        kickPending = false
      } catch (e) {
        if (!alive || (e as Error).name === 'AbortError') return
        kickPending = false
        failures.current += 1
        if (failures.current >= 2) setState({ kind: 'error', detail: (e as Error).message })
        schedule(backoffMs(failures.current))
      } finally {
        inFlight = false
      }
    }
    let inFlight = false
    kick.current = () => {
      if (inFlight) kickPending = true
      else schedule(1500)
    }
    const onVisible = () => {
      if (!document.hidden) schedule(0)
    }
    document.addEventListener('visibilitychange', onVisible)
    schedule(0)
    return () => {
      alive = false
      clearTimeout(timer)
      ctrl?.abort()
      kick.current = () => {}
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])

  // A new camera view asks again soon, not after the full interval.
  const key = view ? `${view.north.toFixed(3)},${view.west.toFixed(3)},${view.south.toFixed(3)},${view.east.toFixed(3)}` : ''
  const lastKey = useRef('')
  useEffect(() => {
    const moved = lastKey.current !== '' && lastKey.current !== key
    lastKey.current = key
    if (enabled && moved && failures.current < 2) kick.current()
  }, [enabled, key])

  return state
}
