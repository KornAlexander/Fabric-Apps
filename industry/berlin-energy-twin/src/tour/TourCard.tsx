import { useEffect } from 'react'
import { fill, type StringKey } from '../i18n/strings'
import type { TourStop } from './tour'

type Props = {
  stops: TourStop[]
  index: number
  onIndex: (i: number) => void
  onEnd: () => void
  t: (k: StringKey) => string
}

const NEXT = new Set(['ArrowRight', 'PageDown', ' ', 'Enter'])
const BACK = new Set(['ArrowLeft', 'PageUp'])

/**
 * The caption card at the bottom centre (decided 2026-10-28) and the
 * presenter's keys. A presentation clicker sends PageDown / PageUp or the
 * arrows, so those step; Esc ends.
 *
 * ⚠️ The keys are caught on WINDOW in the CAPTURE phase and stopped there:
 * MapLibre's own keyboard handler sits on the map container and would pan the
 * map with the same arrow press. Space and Enter on a focused button are left
 * alone, the button's own click already steps once.
 */
export function TourCard({ stops, index, onIndex, onEnd, t }: Props) {
  const stop = stops[index]
  const last = index === stops.length - 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.key === ' ' || e.key === 'Enter') && tag === 'BUTTON') return
      if (NEXT.has(e.key)) {
        if (last) onEnd()
        else onIndex(index + 1)
      } else if (BACK.has(e.key)) {
        if (index > 0) onIndex(index - 1)
      } else if (e.key === 'Escape') {
        onEnd()
      } else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [index, last, onEnd, onIndex])

  const p = stop.params
  return (
    <section className="tour-card" role="dialog" aria-live="polite" aria-label={fill(t(stop.title), p)} data-testid="tour-card" data-stop={stop.id}>
      <div className="tour-head">
        <span className="tour-step" data-testid="tour-step">
          {fill(t('tour.step'), { i: String(index + 1), n: String(stops.length) })}
        </span>
        <button className="tour-x" onClick={onEnd} aria-label={t('tour.close')} title={t('tour.close')}>
          ×
        </button>
      </div>
      <div className="tour-main">
        <div className="tour-text">
          <h2>{fill(t(stop.title), p)}</h2>
          <p>{fill(t(stop.body), p)}</p>
        </div>
        <div className="tour-figure" data-testid="tour-figure">
          <b>{stop.figure}</b>
          <span>{fill(t(stop.figureLabel), p)}</span>
          {stop.badges.length > 0 && (
            <span className="tour-badges">
              {stop.badges.map((b) => (
                <span key={b} className="badge" data-testid={`tour-badge-${b}`}>
                  {t(`badge.${b}` as StringKey)}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
      <div className="tour-foot">
        <span className="tour-source">{t(stop.source)}</span>
        <span className="tour-dots" aria-hidden="true">
          {stops.map((s, i) => (
            <span key={s.id} className={i === index ? 'on' : ''} />
          ))}
        </span>
        <button className="tour-btn" onClick={() => onIndex(index - 1)} disabled={index === 0} data-testid="tour-back">
          {t('tour.back')}
        </button>
        <button className="tour-btn tour-btn-primary" onClick={() => (last ? onEnd() : onIndex(index + 1))} data-testid="tour-next">
          {last ? t('tour.finish') : t('tour.next')}
        </button>
      </div>
    </section>
  )
}
