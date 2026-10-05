/**
 * The data-mode badge on each layer row: what KIND of data is on the map, and from when.
 *
 * ⚠️ THE KIND IS THE LAYER'S, THE TIME IS THE SOURCE'S. Whether a layer is measured, interpolated
 * from the planned service or generated is fixed by how it is built (see `layerDataMode`). The time is the
 * observation time where the source publishes one (the end of an Umweltbundesamt measuring hour,
 * a citizen sensor's own reading time, the relay's snapshot), and otherwise the moment the app
 * fetched. Past a layer's bound, measured data is shown as stale rather than as live.
 */
import { later, locale, t, type MessageKey, type Text } from '../i18n';
import { clock, type LiveStatus } from './source';

export type DataMode = 'live' | 'planned' | 'replay' | 'synthetic' | 'dataset' | 'entries';
export type BadgeMode = DataMode | 'stale';

export interface Badge {
  mode: BadgeMode;
  /** The time the badge shows, or null when the mode has none (generated data). */
  at: Date | null;
  label: Text;
  title: Text;
}

const LABEL: Record<BadgeMode, MessageKey> = {
  live: 'mode.live',
  planned: 'mode.planned',
  replay: 'mode.replay',
  synthetic: 'mode.synthetic',
  dataset: 'mode.dataset',
  entries: 'mode.entries',
  stale: 'mode.stale',
};

const MEANING: Record<DataMode, MessageKey> = {
  live: 'mode.live.title',
  planned: 'mode.planned.title',
  replay: 'mode.replay.title',
  synthetic: 'mode.synthetic.title',
  dataset: 'mode.dataset.title',
  entries: 'mode.entries.title',
};

/**
 * `14:07` today, `05.10. 14:07` on another day.
 *
 * ⚠️ A BARE CLOCK ON A DAY-OLD READING IS A FALSE STATEMENT OF FRESHNESS. A stale station that
 * last published yesterday at 14:00 would otherwise read as this afternoon.
 */
export function stamp(at: Date, now: number): string {
  const today = new Date(now).toDateString() === at.toDateString();
  if (today) return clock(at);
  const day = at.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' });
  return `${day} ${clock(at)}`;
}

/** `2 min` or `2 h`, for the stale explanation. */
function duration(ms: number): string {
  return ms >= 3_600_000 && ms % 3_600_000 === 0 ? `${ms / 3_600_000} h` : `${Math.round(ms / 60_000)} min`;
}

/**
 * The badge for a layer row, or null when nothing is drawn (idle, loading, failed).
 *
 * @param now Epoch milliseconds, passed in so the panel can re-evaluate staleness on a timer.
 * @param staleAfterMs Age past which measured data stops being called live; null = never stale.
 */
export function badgeFor(layerMode: DataMode, status: LiveStatus, now: number, staleAfterMs: number | null): Badge | null {
  if (status.state !== 'live') return null;
  const mode = status.dataMode ?? layerMode;
  const observed = status.observedAt ?? null;
  const at = mode === 'synthetic' ? null : observed ?? status.fetchedAt;
  const stale = staleAfterMs !== null && at !== null && now - at.getTime() > staleAfterMs;
  const shown: BadgeMode = stale ? 'stale' : mode;

  const label: Text = at ? () => `${t(LABEL[shown])} · ${stamp(at, now)}` : later(LABEL[shown]);
  const title: Text = () => {
    const parts = [t(MEANING[mode])];
    if (stale && staleAfterMs !== null) parts.push(t('mode.staleAfter', duration(staleAfterMs)));
    if (observed) parts.push(t('mode.observed', stamp(observed, now)));
    if (status.fetchedAt && mode !== 'synthetic') {
      const key = status.timeBasis === 'computed' ? 'mode.computed' : 'status.fetched';
      parts.push(t(key, stamp(status.fetchedAt, now)));
    }
    return parts.join(' · ');
  };
  return { mode: shown, at, label, title };
}
