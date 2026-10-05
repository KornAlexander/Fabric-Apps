import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import raw from '../../config/availability.json';
import type { WorldMap } from '../../src/map/worldScene';
import type { LayerFactory } from '../../src/layers/factories';
import {
  BUILT_IN_LAYERS, layerAvailableIn, layerDataMode, layerDivision, layerStaleAfterMs,
} from '../../src/layers/factories';
import { WFS_LAYERS } from '../../src/live/wfsCatalogue';
import { AVAILABILITY, layersIn } from '../../src/config/availability';
import { validateAvailability } from '../../src/config/availabilityMatrix.mjs';
import { DIVISIONS } from '../../src/config/pack.mjs';
import { WORLDS, type WorldId } from '../../src/config/world';
import { badgeFor, stamp } from '../../src/live/dataMode';
import type { LiveStatus } from '../../src/live/source';
import { later, setLanguage, show } from '../../src/i18n';
import { LayerPanel } from '../../src/ui/LayerPanel';
import { loadPack } from '../../src/config/activePack';
import generic from '../../config/packs/generic.json';

const CITIES = Object.keys(WORLDS) as WorldId[];
const KNOWN_LAYERS = [...BUILT_IN_LAYERS, ...WFS_LAYERS.map((spec) => spec.id)];
/** The matrix as plain JSON, loose enough to break on purpose. */
type Loose = { cities: Record<string, { divisions: Record<string, Record<string, unknown>>; context: string[] }> };
const clone = () => structuredClone(raw) as unknown as Loose;

beforeEach(() => { act(() => setLanguage('de')); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('availability matrix (P1.4)', () => {
  it('the shipped matrix is valid for every city of the app', () => {
    expect(validateAvailability(raw, CITIES)).toEqual([]);
  });

  it('names only real layers, each under its own division, and offers every layer somewhere', () => {
    const offered = new Set<string>();
    for (const city of CITIES) {
      const entry = AVAILABILITY.cities[city];
      for (const division of DIVISIONS) {
        for (const id of entry.divisions[division as keyof typeof entry.divisions].layers ?? []) {
          expect(KNOWN_LAYERS, `${city}.${division} lists ${id}`).toContain(id);
          expect(layerDivision(id), `${city}: ${id} belongs to another division`).toBe(division);
          offered.add(id);
        }
      }
      for (const id of entry.context ?? []) {
        expect(KNOWN_LAYERS, `${city}.context lists ${id}`).toContain(id);
        expect(layerDivision(id), `${city}: context layer ${id} has a division`).toBeNull();
        offered.add(id);
      }
    }
    // A layer listed nowhere would silently vanish from every city.
    expect(KNOWN_LAYERS.filter((id) => !offered.has(id))).toEqual([]);
  });

  it('decides which layers each city offers', () => {
    expect(layersIn('munich').size).toBe(KNOWN_LAYERS.length);
    expect([...layersIn('hamburg')].sort()).toEqual(['luft-amtlich', 'luft-buerger']);
    expect([...layersIn('stuttgart')].sort()).toEqual(['luft-amtlich', 'luft-buerger']);
    expect(layerAvailableIn('flugverkehr', 'hamburg')).toBe(false);
    expect(layerAvailableIn('luft-buerger', 'stuttgart')).toBe(true);
  });

  it('rejects the mistakes that would make the chip row or the layer list lie', () => {
    const cases: [string, (m: Loose) => void, RegExp][] = [
      ['a missing division', (m) => { delete m.cities.hamburg.divisions.water; }, /hamburg\.divisions\.water is missing/],
      ['an unknown division', (m) => { m.cities.hamburg.divisions.gas = { mode: 'none' }; }, /gas is not a known division/],
      ['a city the app does not ship', (m) => { m.cities.berlin = m.cities.hamburg; }, /berlin is not a city of this app/],
      ['a missing city', (m) => { delete m.cities.stuttgart; }, /stuttgart is missing/],
      ['a source on "none"', (m) => { m.cities.hamburg.divisions.water.source = { de: 'x', en: 'x' }; }, /must not name one/],
      ['layers on "none"', (m) => { m.cities.hamburg.divisions.water.layers = ['trinkbrunnen']; }, /must not list layers/],
      ['"real" without a source', (m) => { delete m.cities.munich.divisions.aviation.source; }, /aviation\.source must be an object/],
      ['"real" without layers', (m) => { m.cities.munich.divisions.aviation.layers = []; }, /aviation\.layers must list at least one/],
      ['an unknown mode', (m) => { m.cities.munich.divisions.aviation.mode = 'live'; }, /mode must be real, synthetic or none/],
      ['a layer listed twice', (m) => { m.cities.munich.context.push('flugverkehr'); }, /already listed for this city/],
      ['a misspelt key', (m) => { m.cities.munich.divisions.aviation.layer = []; }, /layer is not a known property/],
    ];
    for (const [name, mutate, message] of cases) {
      const matrix = clone();
      mutate(matrix);
      expect(validateAvailability(matrix, CITIES).join('\n'), name).toMatch(message);
    }
  });
});

describe('data-mode badge (P1.5)', () => {
  const NOW = new Date(2026, 9, 6, 14, 30).getTime();
  const live = (extra: Partial<LiveStatus> = {}): LiveStatus => ({
    state: 'live', text: 'x', fetchedAt: new Date(NOW - 60_000), count: 1, ...extra,
  });

  it('shows nothing while a layer is idle, loading or failed', () => {
    for (const state of ['idle', 'loading', 'error'] as const) {
      expect(badgeFor('live', { ...live(), state }, NOW, null)).toBeNull();
    }
  });

  it('prefers the time the source observed over the time the app fetched', () => {
    const observedAt = new Date(2026, 9, 6, 14, 0);
    const badge = badgeFor('live', live({ observedAt }), NOW, 2 * 3_600_000)!;
    expect(badge.mode).toBe('live');
    expect(show(badge.label)).toBe('Live · 14:00');
    expect(show(badge.title)).toBe('gemessen und live abgefragt · Messzeit 14:00 · Abruf 14:29');
    act(() => setLanguage('en'));
    expect(show(badge.label)).toBe('Live · 14:00');
    expect(show(badge.title)).toBe('measured and queried live · measured 14:00 · fetched 14:29');
  });

  it('turns measured data stale past its bound, and says by how much', () => {
    const badge = badgeFor('live', live({ observedAt: new Date(NOW - 3 * 60_000) }), NOW, 2 * 60_000)!;
    expect(badge.mode).toBe('stale');
    expect(show(badge.label)).toBe('Veraltet · 14:27');
    expect(show(badge.title)).toMatch(/älter als 2 min/);
    // On another day the date is part of the stamp.
    expect(stamp(new Date(2026, 9, 5, 14, 0), NOW)).toMatch(/^05\.10\.? 14:00$/);
  });

  it('never turns a dataset stale and never puts a time on generated data', () => {
    const old = live({ fetchedAt: new Date(NOW - 86_400_000) });
    expect(badgeFor('dataset', old, NOW, null)!.mode).toBe('dataset');
    const synthetic = badgeFor('synthetic', old, NOW, null)!;
    expect(synthetic.at).toBeNull();
    expect(show(synthetic.label)).toBe('Synthetisch');
  });

  it('lets a status downgrade its layer\'s mode, and calls a computed time computed', () => {
    // MVG answering with planned times only is not a measurement.
    const planned = badgeFor('live', live({ dataMode: 'planned' }), NOW, 5 * 60_000)!;
    expect(planned.mode).toBe('planned');
    expect(show(planned.label)).toBe('Fahrplan · 14:29');
    const vehicles = badgeFor('planned', live({ timeBasis: 'computed' }), NOW, null)!;
    expect(show(vehicles.title)).toBe('aus dem Soll-Fahrplan berechnet, keine Ortung · berechnet 14:29');
  });

  it('gives each layer the kind of data it really draws', () => {
    expect(layerDataMode('flugverkehr')).toBe('live');
    expect(layerDataMode('fahrzeuge')).toBe('planned');
    expect(layerDataMode('baustellen')).toBe('dataset');
    expect(layerDataMode('koordination')).toBe('entries');
    expect(layerDataMode('radwege')).toBe('dataset');
    expect(layerStaleAfterMs('baustellen')).toBeNull();
    expect(layerStaleAfterMs('luft-amtlich')).toBe(2 * 3_600_000);
  });
});

describe('LayerPanel availability and badges', () => {
  const fakeWorld = () => ({ setLayerVisible: vi.fn(), clearPick: vi.fn() }) as unknown as WorldMap;

  it('lists the pack\'s divisions with what this city has', () => {
    const { unmount } = render(<LayerPanel world={fakeWorld()} factories={{}} refreshNotes={async () => {}} />);
    const chip = (division: string) => document.querySelector(`[data-division="${division}"]`)!;
    const label = (division: string) => chip(division).querySelector('.chip-label')!.textContent;
    expect(chip('transit').getAttribute('data-availability')).toBe('real');
    expect(label('transit')).toBe('Verkehr · echt');
    expect(chip('transit').getAttribute('title')).toMatch(/^Geoportal München/);
    // The source is readable without hovering, too.
    expect(chip('transit').querySelector('.visually-hidden')!.textContent).toMatch(/^: Geoportal München/);
    expect(label('water')).toBe('Wasser · keine Quelle');
    expect(chip('water').hasAttribute('title')).toBe(false);
    unmount();

    render(<LayerPanel world={fakeWorld()} factories={{}} refreshNotes={async () => {}} worldId="hamburg" />);
    const modes = [...document.querySelectorAll('#division-chips [data-availability]')].map((li) => li.getAttribute('data-availability'));
    expect(modes).toHaveLength(DIVISIONS.length);
    expect(new Set(modes)).toEqual(new Set(['none']));
  });

  it('shows no chip for a division the pack switches off', () => {
    const pack = loadPack({ ...structuredClone(generic), divisions: { ...generic.divisions, fibre: false } });
    render(<LayerPanel world={fakeWorld()} factories={{}} refreshNotes={async () => {}} pack={pack} />);
    expect(document.querySelector('[data-division="fibre"]')).toBeNull();
    expect(document.querySelector('[data-division="water"]')).not.toBeNull();
  });

  it('badges a live row with its mode and time, drops it when switched off, and flips to stale on its own', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(2026, 9, 6, 14, 30));
    const factory = vi.fn<LayerFactory>(async (_world, onStatus) => {
      onStatus({ state: 'live', text: later('flights.count', 3), fetchedAt: new Date(), count: 3 });
    });
    render(<LayerPanel world={fakeWorld()} factories={{ flugverkehr: factory }} refreshNotes={async () => {}} />);
    const box = screen.getByRole('checkbox', { name: /Flugverkehr/ });
    await act(async () => { fireEvent.click(box); });

    const badge = () => document.querySelector('[data-mode-for="flugverkehr"]');
    expect(badge()!.getAttribute('data-mode')).toBe('live');
    expect(badge()!.textContent).toBe('Live · 14:30');
    // The time lives on the badge, not in the status line as well.
    expect(document.querySelector('[data-state-for="flugverkehr"]')!.textContent).toBe('3 Flugzeuge');
    // The checkbox is described by the status, including the badge's explanation.
    expect(box.getAttribute('aria-describedby')).toBe('layer-status-flugverkehr');
    expect(document.getElementById('layer-status-flugverkehr')!.textContent).toMatch(/gemessen und live abgefragt/);

    // No new poll arrives: past the 2-minute bound the panel's own clock flips it.
    await act(async () => { vi.advanceTimersByTime(150_000); });
    expect(badge()!.getAttribute('data-mode')).toBe('stale');
    expect(badge()!.textContent).toBe('Veraltet · 14:30');

    await act(async () => { fireEvent.click(box); });
    expect(badge()).toBeNull();
  });
});
