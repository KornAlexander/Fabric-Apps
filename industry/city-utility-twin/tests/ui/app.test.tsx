import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../../src/i18n';
import { STORAGE_KEY } from '../../src/i18n/language';

// The scene needs WebGL, which jsdom does not have. The shell only needs its contract.
const world = {
  activeSite: 'munich',
  onPick: vi.fn(),
  onSiteChange: vi.fn(),
  flyToSite: vi.fn(),
  faceNorth: vi.fn(),
  reset: vi.fn(),
  clearPick: vi.fn(),
  setLayerVisible: vi.fn(),
  debug: () => ({ frames: 1 }),
  dispose: vi.fn(),
};
vi.mock('../../src/map/worldScene', () => ({
  createWorldMap: vi.fn(async () => world),
}));
vi.mock('../../src/agent/token', () => ({
  account: async () => 'Erika Muster',
  token: async () => 'token',
  signIn: async () => null,
}));

const { App } = await import('../../src/App');

beforeEach(() => {
  act(() => setLanguage('de'));
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => { cleanup(); });

describe('App shell', () => {
  it('shows the German shell once the scene is ready and switches everything to English', async () => {
    render(<App />);
    await screen.findByRole('group', { name: 'Ort wählen' });
    expect(screen.getByRole('button', { name: /München Zentrum/ })).toBeTruthy();
    expect(document.querySelector('#city-map')!.getAttribute('data-ready')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }));

    await screen.findByRole('group', { name: 'Choose a site' });
    expect(screen.getByRole('button', { name: /Munich city centre/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Data layers' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Auf Deutsch umschalten' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
    expect(new URL(window.location.href).searchParams.get('lang')).toBe('en');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('en');
    await waitFor(() => expect(document.title).toBe('City Utility Twin · Munich city centre'));
  });

  it('wires the map controls to the scene', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nach Norden ausrichten' }));
    fireEvent.click(screen.getByRole('button', { name: /Flughafen München/ }));
    expect(world.faceNorth).toHaveBeenCalled();
    expect(world.flyToSite).toHaveBeenCalledWith('flughafen');
  });

  // Review 2026-10-05: the author line was stored as a string by the state setter and stayed
  // German after a switch.
  it('redraws the resolved author line in the new language', async () => {
    render(<App />);
    expect(await screen.findByText('Notizen werden erfasst als Erika Muster. Der Autor wird serverseitig geprüft.')).toBeTruthy();
    act(() => setLanguage('en'));
    expect(screen.getByText('Notes are recorded as Erika Muster. The author is checked on the server.')).toBeTruthy();
  });
});
