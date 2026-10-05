import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { WorldMap } from '../map/worldScene';
import { groupedLayers, type WfsLayerSpec } from '../live/wfsCatalogue';
import { idleStatus, type LiveStatus } from '../live/source';
import { badgeFor } from '../live/dataMode';
import { later, show, t, type MessageKey, type Text } from '../i18n';
import { useLanguage } from '../i18n/useLanguage';
import { isUnofficial } from '../config/feeds';
import {
  BUILT_IN_LAYERS, layerAvailableIn, layerDataMode, layerInPack, layerNameKey, layerSourceKey,
  layerStaleAfterMs, type LayerFactory,
} from '../layers/factories';
import { PACK, divisionOn, type ConfigPack, type Division } from '../config/activePack';
import { DIVISIONS } from '../config/pack.mjs';
import { divisionAvailability, divisionSource, type AvailabilityMode } from '../config/availability';
import type { WorldId } from '../config/world';

/** How often the panel re-checks whether a live layer's data has gone stale. */
const STALE_CHECK_MS = 30_000;

const DIVISION_NAME = {
  transit: 'division.transit',
  construction: 'division.construction',
  water: 'division.water',
  power: 'division.power',
  heat: 'division.heat',
  emobility: 'division.emobility',
  fibre: 'division.fibre',
  aviation: 'division.aviation',
} as const satisfies Record<Division, MessageKey>;

const AVAILABILITY_WORD = {
  real: 'availability.real',
  synthetic: 'availability.synthetic',
  none: 'availability.none',
} as const satisfies Record<AvailabilityMode, MessageKey>;

interface RowState {
  checked: boolean;
  busy: boolean;
  status: LiveStatus;
}

export interface LayerPanelProps {
  world: WorldMap;
  factories: Record<string, LayerFactory>;
  /** Reload the notes layer; resolves when the reload has finished. */
  refreshNotes(): Promise<void>;
  /** The config pack; layers of divisions it switches off are not listed. */
  pack?: ConfigPack;
  /** The city on screen; layers without a source there are shown as such. */
  worldId?: WorldId;
}

/** The data layer panel: built-in layers first, then the open-data catalogue by group. */
export function LayerPanel({ world, factories, refreshNotes, pack = PACK, worldId = 'munich' }: LayerPanelProps) {
  useLanguage();
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [refreshing, setRefreshing] = useState(false);
  // A badge can go stale with no new status arriving (a source that stopped publishing), so the
  // panel re-renders on its own clock as well.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), STALE_CHECK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const built = useRef(new Set<string>());
  const allGroups = useMemo(() => groupedLayers()
    .map(({ group, layers }) => ({ group, layers: layers.filter((spec) => layerInPack(spec.id, pack)) }))
    .filter(({ layers }) => layers.length > 0), [pack]);
  // The catalogue is one city's open data; elsewhere it is one line, not a wall of disabled rows.
  const groups = useMemo(() => allGroups
    .map(({ group, layers }) => ({ group, layers: layers.filter((spec) => layerAvailableIn(spec.id, worldId)) }))
    .filter(({ layers }) => layers.length > 0), [allGroups, worldId]);
  const builtIn = useMemo(() => BUILT_IN_LAYERS.filter((id) => layerInPack(id, pack)), [pack]);
  // Only the divisions this pack runs; a switched-off division is not this utility's business.
  const divisions = useMemo(
    () => (DIVISIONS as readonly Division[]).filter((division) => divisionOn(division, pack)),
    [pack],
  );

  const row = (id: string): RowState =>
    rows[id] ?? { checked: false, busy: false, status: idleStatus() };

  const update = useCallback((id: string, patch: Partial<RowState>) => {
    setRows((all) => ({
      ...all,
      [id]: { ...(all[id] ?? { checked: false, busy: false, status: idleStatus() }), ...patch },
    }));
  }, []);

  const toggle = async (id: string, checked: boolean) => {
    const factory = factories[id];
    if (!factory) return;
    update(id, { checked });
    if (checked && !built.current.has(id)) {
      update(id, {
        busy: true,
        status: { state: 'loading', text: later('layer.preparing'), fetchedAt: null, count: 0 },
      });
      try {
        await factory(world, (status) => update(id, { status }));
        built.current.add(id);
      } catch (error) {
        const reason: Text = error instanceof Error ? error.message : later('layer.unavailable');
        update(id, { checked: false, status: { state: 'error', text: reason, fetchedAt: null, count: 0 } });
        return;
      } finally {
        update(id, { busy: false });
      }
    }
    world.setLayerVisible(id, checked);
  };

  const refresh = () => {
    setRefreshing(true);
    void refreshNotes().finally(() => setRefreshing(false));
  };

  /**
   * One row. ⚠️ A ROW WITH NO FACTORY IS DISABLED AND SAYS SO: a checkbox with nothing behind it
   * would silently do nothing, which is worse than not offering it at all.
   */
  const renderRow = (id: string, name: Text, source: Text, extra?: ReactNode) => {
    const state = row(id);
    const missing = !factories[id];
    const status: LiveStatus = missing
      ? {
        ...idleStatus(),
        text: later(!layerAvailableIn(id, worldId) ? 'layer.otherCity'
          : isUnofficial(id) ? 'layer.unofficialOff' : 'layer.notIncluded'),
      }
      : state.status;
    // Only on a row that is switched on: an old status kept for an unchecked row describes data
    // that is no longer on the map.
    const badge = !missing && state.checked
      ? badgeFor(layerDataMode(id), status, now, layerStaleAfterMs(id))
      : null;
    return (
      <li key={id}>
        <label>
          <input
            type="checkbox"
            data-layer={id}
            checked={state.checked}
            disabled={missing || state.busy}
            aria-describedby={`layer-status-${id}`}
            onChange={(event) => { void toggle(id, event.currentTarget.checked); }}
          />
          <span className="layer-name">{show(name)}</span>
          <span className="layer-source">{show(source)}</span>
        </label>
        <div className="layer-status" id={`layer-status-${id}`}>
          {badge ? (
            <>
              <span className="layer-badge" data-mode-for={id} data-mode={badge.mode} title={show(badge.title)}>
                {show(badge.label)}
              </span>
              {/* The tooltip's explanation, for keyboard and screen-reader users too. */}
              <span className="visually-hidden">{show(badge.title)}</span>
            </>
          ) : null}
          <span className="layer-state" data-state-for={id} data-state={status.state}>{show(status.text)}</span>
        </div>
        {extra}
      </li>
    );
  };

  const catalogueSource = (spec: WfsLayerSpec): Text =>
    spec.geometry === 'point' ? () => t('layer.symbols', show(spec.source)) : spec.source;

  return (
    <aside id="layers" aria-label={t('layers.title')}>
      <h2>{t('layers.title')}</h2>
      <p className="layers-note">{t('layers.note')}</p>
      <p className="layers-note division-title">{t('availability.title')}</p>
      <ul className="division-chips" id="division-chips" aria-label={t('availability.title')}>
        {divisions.map((division) => {
          const entry = divisionAvailability(worldId, division);
          const source = divisionSource(entry);
          return (
            <li
              key={division}
              data-division={division}
              data-availability={entry.mode}
              title={source ? show(source) : undefined}
            >
              <span className="chip-label">{t(DIVISION_NAME[division])} · {t(AVAILABILITY_WORD[entry.mode])}</span>
              {source ? <span className="visually-hidden">: {show(source)}</span> : null}
            </li>
          );
        })}
      </ul>
      <ul>
        {builtIn.map((id) => renderRow(
          id,
          later(layerNameKey(id)),
          later(layerSourceKey(id, worldId)),
          // A note somebody else published is not pushed to this browser, so the layer offers an
          // explicit reload, shown only while the layer is on: a button that reloads an invisible
          // layer would do nothing a user could see.
          id === 'koordination' && row(id).checked ? (
            <button
              id="koordination-refresh"
              type="button"
              className="layer-refresh"
              title={t('layer.refreshTitle')}
              disabled={refreshing}
              onClick={refresh}
            >
              {refreshing ? t('layer.refreshing') : t('layer.refresh')}
            </button>
          ) : undefined,
        ))}
      </ul>
      <div id="layer-groups">
        {groups.length < allGroups.length ? (
          <p className="layers-note" id="catalogue-other-city">{t('layers.catalogueOtherCity')}</p>
        ) : null}
        {groups.map(({ group, layers }) => (
          <details className="layer-group" key={layers[0].id}>
            <summary>{t('layer.group', show(group), layers.length)}</summary>
            <ul>{layers.map((spec) => renderRow(spec.id, spec.label, catalogueSource(spec)))}</ul>
          </details>
        ))}
      </div>
    </aside>
  );
}
