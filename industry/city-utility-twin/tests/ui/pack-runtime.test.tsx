import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import schema from '../../config/packs/pack.schema.json';
import generic from '../../config/packs/generic.json';
import { setLanguage } from '../../src/i18n';
import { applyBrand, loadPack, packSites, packStartSite, type ConfigPack } from '../../src/config/activePack';
import { packSiteErrors, validatePack } from '../../src/config/pack.mjs';

const world = {
  activeSite: 'munich', onPick: vi.fn(), onSiteChange: vi.fn(), flyToSite: vi.fn(), faceNorth: vi.fn(),
  reset: vi.fn(), clearPick: vi.fn(), setLayerVisible: vi.fn(), debug: () => ({ frames: 1 }), dispose: vi.fn(),
};
const createWorldMap = vi.fn(async (..._args: unknown[]) => world);
vi.mock('../../src/map/worldScene', () => ({ createWorldMap: (...args: unknown[]) => createWorldMap(...args) }));
vi.mock('../../src/agent/token', () => ({ account: async () => null, token: async () => null, signIn: async () => null }));
const { App } = await import('../../src/App');

const pack = (patch: Partial<ConfigPack>): ConfigPack => ({ ...structuredClone(generic), ...patch } as ConfigPack);

beforeEach(() => { act(() => setLanguage('de')); window.history.replaceState(null, '', '/'); });
afterEach(() => { cleanup(); createWorldMap.mockClear(); });

describe('config pack contract', () => {
  const validate = new Ajv2020({ allErrors: true }).compile(schema);

  it('the shipped generic pack satisfies both the JSON schema and the runtime validator', () => {
    expect(validate(generic), JSON.stringify(validate.errors)).toBe(true);
    expect(validatePack(generic)).toEqual([]);
  });

  it('schema and runtime validator reject the same broken packs', () => {
    const without = (key: string) => { const copy = structuredClone(generic) as Record<string, unknown>; delete copy[key]; return copy; };
    const broken = [
      pack({ id: 'Not Kebab' }),
      pack({ defaultCity: 'nowhere' as string }),
      pack({ divisions: { transit: 'yes' as unknown as boolean } }),
      pack({ brand: { name: { de: 'X', en: '' } } }),
      pack({ agent: { persona: 'p', language: 'fr' as 'de' } }),
      // A misspelt or missing section must not be silently ignored (review 2026-10-05).
      without('texts'),
      without('kpiTargets'),
      { ...structuredClone(generic), divison: { transit: true } },
      pack({ cities: [{ id: 'munich', aois: ['munich', 'flughafen'], status: 'ready', colour: 'x' } as ConfigPack['cities'][number]] }),
      pack({ agent: { persona: 'p', language: 'de', tone: 'x' } as ConfigPack['agent'] }),
      pack({ brand: { name: { de: 'X', en: 'Y', fr: 'Z' } as ConfigPack['brand']['name'] } }),
    ];
    for (const candidate of broken.slice(0, 1).concat(broken.slice(2))) {
      expect(validate(candidate), JSON.stringify(candidate).slice(0, 60)).toBe(false);
    }
    for (const candidate of broken) expect(validatePack(candidate).length, JSON.stringify(candidate).slice(0, 60)).toBeGreaterThan(0);
  });

  it('selects only ready cities\' shipped sites and requires the world shell', () => {
    expect(packSites(loadPack(generic)).map((site) => site.id)).toEqual(['munich', 'flughafen', 'hamburg-centre', 'stuttgart-centre']);
    expect(packStartSite(loadPack(generic))).toBe('munich');
    const cityOnly = pack({ cities: [{ id: 'munich', aois: ['munich'], status: 'ready' }] });
    expect(() => packSites(cityOnly)).toThrow(/world shell/);
  });

  it('fails a ready city whose AOI this build does not ship, instead of dropping it', () => {
    const shipped = { munich: 'munich', flughafen: 'munich' };
    const shells = { munich: 'flughafen', hamburg: 'hamburg-centre' };
    const early = pack({ cities: [
      { id: 'munich', aois: ['munich', 'flughafen'], status: 'ready' },
      { id: 'hamburg', aois: ['hamburg-centre'], status: 'ready' },
    ] });
    expect(packSiteErrors(early, shipped, shells)).toEqual(['city hamburg is ready, but this build does not ship its AOI hamburg-centre']);
    expect(packSiteErrors(loadPack(generic),
      { munich: 'munich', flughafen: 'munich', 'hamburg-centre': 'hamburg', 'stuttgart-centre': 'stuttgart' },
      { ...shells, stuttgart: 'stuttgart-centre' })).toEqual([]);
    // An AOI listed under the wrong city would show in that city's switcher and fail to load.
    const misfiled = pack({ defaultCity: 'hamburg', cities: [
      { id: 'hamburg', aois: ['hamburg-centre', 'munich'], status: 'ready' },
    ] });
    expect(() => packSites(misfiled)).toThrow(/city hamburg lists AOI munich, which belongs to munich/);
    // A city this build has no world for at all fails at startup too, naming the city.
    const unknown = pack({ cities: [
      { id: 'munich', aois: ['munich', 'flughafen'], status: 'ready' },
      { id: 'berlin', aois: ['berlin-centre'], status: 'ready' },
    ] });
    expect(() => packSites(unknown)).toThrow(/berlin-centre[\s\S]*no world for it/);
  });

  it('requires each ready city to ship its own world shell', () => {
    const hamburgOnly = pack({ defaultCity: 'hamburg', cities: [
      { id: 'munich', aois: ['munich', 'flughafen'], status: 'planned' },
      { id: 'hamburg', aois: ['hamburg-centre'], status: 'ready' },
    ] });
    expect(packSites(hamburgOnly).map((site) => site.id)).toEqual(['hamburg-centre']);
    expect(packStartSite(hamburgOnly)).toBe('hamburg-centre');
  });

  it('brands through pack variables, so the dark theme keeps its own accent', () => {
    const root = document.createElement('div');
    applyBrand(pack({ brand: { name: generic.brand.name, colors: { accent: '#00A36C', alert: '#FF0000' } } }), root);
    expect(root.style.getPropertyValue('--pack-accent')).toBe('#00A36C');
    expect(root.style.getPropertyValue('--pack-alert')).toBe('#FF0000');
    expect(root.style.getPropertyValue('--pack-accent-dark')).toBe('');
    // The theme tokens themselves are never written inline: that would beat html[data-theme="dark"].
    expect(root.style.getPropertyValue('--cp-accent')).toBe('');
    expect(root.style.getPropertyValue('--cp-danger')).toBe('');
  });
});

describe('a different pack changes the running app', () => {
  it('renames the app, drops switched-off divisions and passes its sites to the scene', async () => {
    const custom = pack({
      id: 'beispielstadt',
      brand: { name: { de: 'Stadtwerke Beispielstadt', en: 'Beispielstadt Utilities' }, colors: { accent: '#00A36C', alert: '#FF0000' } },
      divisions: { construction: true, aviation: false, transit: false },
    });
    render(<App pack={custom} />);
    await screen.findByRole('heading', { name: 'Datenebenen' });

    expect(document.title).toBe('Stadtwerke Beispielstadt · München Zentrum');
    expect(screen.queryByRole('checkbox', { name: /Flugverkehr/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /MVG Echtzeit/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Fahrzeuge auf der Strecke/ })).toBeNull();
    expect(screen.queryByText(/^Verkehr und Parken/)).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Baustellen und Halteverbote/ })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Luftqualität amtlich/ })).toBeTruthy();

    const sitesArg = createWorldMap.mock.calls[0][5] as { id: string }[];
    expect(sitesArg.map((site) => site.id)).toEqual(['munich', 'flughafen']);

    act(() => setLanguage('en'));
    expect(document.title).toBe('Beispielstadt Utilities · Munich city centre');
  });

  it('switching to another city rebuilds the scene with that city only', async () => {
    render(<App pack={loadPack(generic)} />);
    await screen.findByRole('heading', { name: 'Datenebenen' });
    expect((createWorldMap.mock.calls[0][5] as { id: string }[]).map((s) => s.id)).toEqual(['munich', 'flughafen']);
    world.dispose.mockClear();

    await act(async () => { screen.getByRole('button', { name: /Hamburg Innenstadt/ }).click(); });
    await screen.findByRole('heading', { name: 'Datenebenen' });
    const last = createWorldMap.mock.calls.at(-1)!;
    expect(last[3]).toBe('hamburg-centre');
    expect((last[5] as { id: string }[]).map((s) => s.id)).toEqual(['hamburg-centre']);
    expect(world.dispose).toHaveBeenCalledTimes(1);
    // The assistant's tools are Munich's; it is not offered elsewhere.
    expect(screen.queryByRole('button', { name: /Assistent/ })).toBeNull();
    expect(new URL(window.location.href).searchParams.get('ort')).toBe('hamburg-centre');

    // Munich-only sources are offered as such, not silently empty.
    expect((screen.getByRole('checkbox', { name: /Baustellen und Halteverbote/ }) as HTMLInputElement).disabled).toBe(true);
    expect(document.querySelector('[data-state-for="baustellen"]')?.textContent).toBe('in dieser Stadt nicht verfügbar');
    expect((screen.getByRole('checkbox', { name: /Luftqualität amtlich/ }) as HTMLInputElement).disabled).toBe(false);
    expect(document.getElementById('catalogue-other-city')).not.toBeNull();
  });
});
