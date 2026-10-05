import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PickDetail, WorldMap } from '../../src/map/worldScene';
import type { LayerFactory } from '../../src/layers/factories';
import { later, setLanguage } from '../../src/i18n';
import { LayerPanel } from '../../src/ui/LayerPanel';
import { DetailPanel } from '../../src/ui/DetailPanel';
import { Assistant } from '../../src/ui/Assistant';
import { ask, publishDraft } from '../../src/agent/client';

vi.mock('../../src/agent/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/agent/client')>()),
  ask: vi.fn(),
  publishDraft: vi.fn(),
}));

function fakeWorld() {
  return { setLayerVisible: vi.fn(), clearPick: vi.fn() } as unknown as WorldMap & {
    setLayerVisible: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => { act(() => setLanguage('de')); });
afterEach(() => { cleanup(); });

describe('LayerPanel', () => {
  it('builds a layer on first switch-on and redraws its status in the new language without a new poll', async () => {
    const world = fakeWorld();
    const factory = vi.fn<LayerFactory>(async (_world, onStatus) => {
      onStatus({ state: 'live', text: later('flights.count', 7), fetchedAt: new Date(), count: 7 });
    });
    render(<LayerPanel world={world} factories={{ flugverkehr: factory }} refreshNotes={async () => {}} />);

    const box = screen.getByRole('checkbox', { name: /Flugverkehr/ });
    await act(async () => { fireEvent.click(box); });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(world.setLayerVisible).toHaveBeenCalledWith('flugverkehr', true);
    const state = document.querySelector('[data-state-for="flugverkehr"]')!;
    expect(state.textContent).toBe('7 Flugzeuge');
    expect(state.getAttribute('data-state')).toBe('live');

    act(() => setLanguage('en'));
    expect(state.textContent).toBe('7 aircraft');
    expect(screen.getByRole('heading', { name: 'Data layers' })).toBeTruthy();
    expect(factory).toHaveBeenCalledTimes(1);

    // Switching off and on again reuses the built layer.
    await act(async () => { fireEvent.click(box); });
    await act(async () => { fireEvent.click(box); });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('disables a row that has no factory and says so', () => {
    render(<LayerPanel world={fakeWorld()} factories={{}} refreshNotes={async () => {}} />);
    const box = screen.getByRole('checkbox', { name: /Baustellen und Halteverbote/ }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(document.querySelector('[data-state-for="baustellen"]')!.textContent).toBe('nicht enthalten');
  });

  it('reverts the checkbox and shows the reason when building fails', async () => {
    const factory = vi.fn<LayerFactory>(async () => { throw new Error('kaputt'); });
    render(<LayerPanel world={fakeWorld()} factories={{ mvg: factory }} refreshNotes={async () => {}} />);
    const box = screen.getByRole('checkbox', { name: /MVG Echtzeit/ }) as HTMLInputElement;
    await act(async () => { fireEvent.click(box); });
    expect(box.checked).toBe(false);
    expect(document.querySelector('[data-state-for="mvg"]')!.textContent).toBe('kaputt');
  });
});

describe('DetailPanel', () => {
  const detail: PickDetail = {
    layerId: 'baustellen',
    title: 'Lothstraße 12',
    subtitle: 'Baustelle',
    fields: [
      { label: later('field.description'), value: '<img src=x onerror="window.__owned=1">' },
    ],
    source: later('roadworks.source'),
    baustelleId: 'baustellen_opendata.1',
  };

  it('renders source values as text, never as markup', () => {
    render(<DetailPanel detail={detail} onClose={() => {}} onNoteSaved={() => {}} />);
    expect(screen.getByText('<img src=x onerror="window.__owned=1">')).toBeTruthy();
    expect(document.querySelector('#detail img')).toBeNull();
  });

  it('switches app labels with the language and keeps the source values as published', () => {
    render(<DetailPanel detail={detail} onClose={() => {}} onNoteSaved={() => {}} />);
    expect(screen.getByText('Beschreibung')).toBeTruthy();
    act(() => setLanguage('en'));
    expect(screen.getByText('Description')).toBeTruthy();
    expect(screen.getByText('Lothstraße 12')).toBeTruthy();
    expect(screen.getByText(/^Source: City of Munich, open data/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add coordination note' })).toBeTruthy();
  });

  it('offers a note only on a construction site', () => {
    render(<DetailPanel detail={{ ...detail, layerId: 'luft-amtlich', baustelleId: undefined }} onClose={() => {}} onNoteSaved={() => {}} />);
    expect(screen.queryByRole('button', { name: /Koordinationsnotiz/ })).toBeNull();
  });

  // Review 2026-10-05: a translation function handed straight to a state setter ran as an
  // updater and froze the status line in the language of the moment.
  it('redraws a form status line in the new language', () => {
    render(<DetailPanel detail={detail} onClose={() => {}} onNoteSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Koordinationsnotiz hinzufügen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(screen.getByText('Bitte einen Text eingeben.')).toBeTruthy();
    act(() => setLanguage('en'));
    expect(screen.getByText('Please enter some text.')).toBeTruthy();
  });
});

describe('Assistant', () => {
  const props = { onNoteSaved: () => {}, onSignIn: async () => null, authorNote: null, offerSignIn: false };

  it('opens with the cursor in the question field and closes back to the toggle', () => {
    render(<Assistant {...props} />);
    const toggle = screen.getByRole('button', { name: 'Assistent' });
    fireEvent.click(toggle);
    expect(document.activeElement?.id).toBe('assistant-input');
    expect(toggle.hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Assistent schließen' }));
    expect((document.querySelector('#assistant') as HTMLElement).hidden).toBe(true);
    expect(toggle.hidden).toBe(false);
  });

  it('keeps a draft\'s actions after a failed publish so it can be retried', async () => {
    const draft = { entwurfId: 'e1', kategorie: 'Konflikt vermutet', text: 'Zwei Gräben' };
    vi.mocked(ask).mockImplementation(async function* () {
      yield { type: 'tool_result', name: 'entwurf', summary: 'Entwurf angelegt', entwurf: draft };
      yield { type: 'delta', text: 'Fertig' };
    });
    vi.mocked(publishDraft).mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce({ ok: true });
    const saved = vi.fn();
    render(<Assistant {...props} onNoteSaved={saved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Assistent' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Frage' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fragen' })); });

    expect(screen.getByText('Entwurf · Konflikt vermutet')).toBeTruthy();
    expect(screen.getByText('Fertig')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Notiz speichern' })); });
    expect(screen.getByText(/Nicht veröffentlicht: HTTP 503/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Notiz speichern' })); });
    expect(saved).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Notiz speichern' })).toBeNull();
    act(() => setLanguage('en'));
    expect(screen.getByText('Draft · Suspected conflict')).toBeTruthy();
    expect(screen.getByText(/^Saved\. The note appears/)).toBeTruthy();
  });
});
