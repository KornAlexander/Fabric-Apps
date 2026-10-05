import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { WorldMap } from '../map/worldScene';
import { groupedLayers, type WfsLayerSpec } from '../live/wfsCatalogue';
import { idleStatus, type LiveStatus } from '../live/source';
import { later, show, t, type Text } from '../i18n';
import { useLanguage } from '../i18n/useLanguage';
import { isUnofficial } from '../config/feeds';
import {
  BUILT_IN_LAYERS, layerAvailableIn, layerInPack, layerNameKey, layerSourceKey, type LayerFactory,
} from '../layers/factories';
import { PACK, type ConfigPack } from '../config/activePack';
import type { WorldId } from '../config/world';

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
  const built = useRef(new Set<string>());
  const allGroups = useMemo(() => groupedLayers()
    .map(({ group, layers }) => ({ group, layers: layers.filter((spec) => layerInPack(spec.id, pack)) }))
    .filter(({ layers }) => layers.length > 0), [pack]);
  // The catalogue is one city's open data; elsewhere it is one line, not a wall of disabled rows.
  const groups = useMemo(() => allGroups
    .map(({ group, layers }) => ({ group, layers: layers.filter((spec) => layerAvailableIn(spec.id, worldId)) }))
    .filter(({ layers }) => layers.length > 0), [allGroups, worldId]);
  const builtIn = useMemo(() => BUILT_IN_LAYERS.filter((id) => layerInPack(id, pack)), [pack]);

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
    return (
      <li key={id}>
        <label>
          <input
            type="checkbox"
            data-layer={id}
            checked={state.checked}
            disabled={missing || state.busy}
            onChange={(event) => { void toggle(id, event.currentTarget.checked); }}
          />
          <span className="layer-name">{show(name)}</span>
          <span className="layer-source">{show(source)}</span>
        </label>
        <span className="layer-state" data-state-for={id} data-state={status.state}>{show(status.text)}</span>
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
      <ul>
        {builtIn.map((id) => renderRow(
          id,
          later(layerNameKey(id)),
          later(layerSourceKey(id)),
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
