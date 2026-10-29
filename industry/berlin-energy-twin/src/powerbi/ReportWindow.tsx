import { useEffect, useState } from 'react'

import type { StringKey } from '../i18n/strings'

/**
 * The Power BI report in a window over the map (PLAN §5 "Report window", D57), like the Fresenius
 * twin's: the published import model's report, one page at a time, following the lens.
 *
 * ⚠️ THE APP CANNOT SEE INTO THIS FRAME, AND MUST NOT PRETEND TO. It is another origin: `onLoad`
 * fires for Power BI's sign-in page and its error page exactly as for the report, so there is no
 * "loaded" state. The footer says what is true whatever the frame shows.
 *
 * ⚠️ `key={url}` REPLACES THE FRAME rather than navigating it, so a page switch never leaves the
 * previous page on screen under the new title, and adds no history entry.
 */
export type ReportPage = 'stadtwerke' | 'degewo' | 'bvg' | 'laden'
export const REPORT_PAGES: ReportPage[] = ['stadtwerke', 'degewo', 'bvg', 'laden']

export function ReportWindow({
  url,
  page,
  onPage,
  onClose,
  t,
  onMax,
}: {
  url: string
  page: ReportPage
  onPage: (p: ReportPage) => void
  onClose: () => void
  t: (k: StringKey) => string
  /** tells the app when the window covers everything (the credits then go on top) */
  onMax?: (max: boolean) => void
}) {
  const [max, setMaxState] = useState(false)
  const toggleMax = () => {
    setMaxState(!max)
    onMax?.(!max)
  }
  // Closing (or the tour hiding it) while maximised must give the credits their place back.
  useEffect(() => () => onMax?.(false), [onMax])
  return (
    <section className="report-window" data-max={max ? 'true' : 'false'} data-testid="report-window" aria-label={t('report.title')}>
      <header className="report-head">
        <b>{t('report.title')}</b>
        <div className="seg seg-light" role="group" aria-label={t('report.pages')}>
          {REPORT_PAGES.map((p) => (
            <button key={p} aria-pressed={page === p} onClick={() => onPage(p)} data-testid={`report-page-${p}`}>
              {t(`report.page.${p}` as StringKey)}
            </button>
          ))}
        </div>
        <span className="header-spacer" />
        <button className="report-icon" onClick={toggleMax} title={max ? t('report.restore') : t('report.maximise')} aria-label={max ? t('report.restore') : t('report.maximise')}>
          {max ? '▭' : '⛶'}
        </button>
        <button className="report-icon" onClick={onClose} title={t('report.close')} aria-label={t('report.close')} data-testid="report-close">
          ×
        </button>
      </header>
      <iframe key={url} data-testid="report-frame" title={t('report.title')} src={url} allowFullScreen className="report-frame" />
      <p className="report-foot">
        <span>{t('report.hint')}</span>
        <a href={url} target="_blank" rel="noopener noreferrer" data-testid="report-newtab">
          {t('report.newTab')}
        </a>
      </p>
    </section>
  )
}
