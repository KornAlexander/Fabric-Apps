import './style.css';
import { createWorldMap, type WorldMap, type PickDetail } from './map/worldScene';
import { SITES, requestedSiteId } from './config/world';
import { createFlugverkehrLayer } from './live/flugverkehr';
import { createBaustellenLayer } from './live/baustellen';
import { createMvgLayer } from './live/mvg';
import { createLuftAmtlichLayer } from './live/luftAmtlich';
import { createLuftBuergerLayer } from './live/luftBuerger';
import { createKoordinationLayer, type KoordinationLayer } from './live/koordination';
import { createWfsLayer } from './live/wfs';
import { createFahrzeugeLayer } from './live/fahrzeuge';
import { WFS_LAYERS, groupedLayers } from './live/wfsCatalogue';
import { idleStatus, type LiveStatus } from './live/source';
import { wireChat } from './ui/chat';
import { createNote, setAuthor, author } from './agent/client';
import { account as entraAccount, signIn as entraSignIn, token as entraToken } from './agent/token';

declare global {
  interface Window { __zwilling?: () => Record<string, unknown>; }
}

/**
 * Wording for the author line that matches what the server will actually see.
 *
 * ⚠️ A CACHED ACCOUNT IS NOT PROOF OF VERIFICATION. Reading an account out of the MSAL cache only
 * says somebody signed in at some point. It does not say a token can still be obtained, and
 * without a token the write is attributed but unverified. Claiming "serverseitig geprüft" on the
 * strength of a cached name was untrue, and a reload could contradict what the sign-in had just
 * said. Ask for a token and let the answer decide the sentence.
 */
async function authorNoteFor(name: string): Promise<string> {
  const proven = Boolean(await entraToken());
  return proven
    ? `Notizen werden erfasst als ${name}. Der Autor wird serverseitig geprüft.`
    : `Angemeldet als ${name}, aber derzeit ist keine Prüfung möglich. Notizen werden als gemeldet gespeichert.`;
}

const canvas = document.querySelector<HTMLCanvasElement>('#city-map')!;
const loading = document.querySelector<HTMLElement>('#loading')!;
const detail = document.querySelector<HTMLElement>('#loading-detail')!;
const progress = document.querySelector<HTMLProgressElement>('#progress')!;
const errorPanel = document.querySelector<HTMLElement>('#error')!;
const controls = document.querySelector<HTMLElement>('#map-controls')!;
const switcher = document.querySelector<HTMLElement>('#site-switch')!;
const layerPanel = document.querySelector<HTMLElement>('#layers')!;
const hint = document.querySelector<HTMLElement>('#navigation-hint')!;
const hud = document.querySelector<HTMLElement>('#drone-hud')!;

const stages: Record<string, string> = {
  terrain: 'Gelände', drape: 'Luftbild', buildings: 'Gebäude', vegetation: 'Bäume',
};

let map: WorldMap | null = null;
let closed = false;
const loadingRequest = new AbortController();

function showError() {
  delete canvas.dataset.ready;
  loading.hidden = true;
  controls.hidden = true;
  switcher.hidden = true;
  layerPanel.hidden = true;
  detailPanel.hidden = true;
  hud.hidden = true;
  hint.hidden = true;
  errorPanel.hidden = false;
}

function teardown() {
  closed = true;
  loadingRequest.abort();
  map?.dispose();
  map = null;
  delete window.__zwilling;
}

document.querySelector('#retry')!.addEventListener('click', () => location.reload());
document.querySelector('#north')!.addEventListener('click', () => map?.faceNorth());
document.querySelector('#home')!.addEventListener('click', () => map?.reset());
document.querySelector('#detail-close')!.addEventListener('click', () => map?.clearPick());
window.addEventListener('keydown', (event) => {
  // ⚠️ Only when the panel is open. Escape also releases the free-flight camera, and stealing it
  // while flying would mean the key no longer does the thing the on-screen hint promises.
  if (event.key === 'Escape' && !detailPanel.hidden) map?.clearPick();
});
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  teardown();
  showError();
});
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  teardown();
});

// ------------------------------------------------------------------ detail panel
const detailPanel = document.querySelector<HTMLElement>('#detail')!;
const detailKind = document.querySelector<HTMLElement>('#detail-kind')!;
const detailTitle = document.querySelector<HTMLElement>('#detail-title')!;
const detailFields = document.querySelector<HTMLElement>('#detail-fields')!;
const detailSource = document.querySelector<HTMLElement>('#detail-source')!;

/**
 * Show what the source published about the clicked object.
 *
 * ⚠️ EVERY VALUE GOES IN AS TEXT, never as markup. These strings come from a third-party open
 * data service and are shown verbatim; building them into HTML would turn somebody else's free
 * text field into script in this page. `textContent` makes that impossible rather than unlikely.
 */
function showDetail(detail: PickDetail | null) {
  if (!detail) {
    detailPanel.hidden = true;
    detailFields.replaceChildren();
    return;
  }
  detailKind.textContent = detail.subtitle ?? '';
  detailKind.hidden = !detail.subtitle;
  detailTitle.textContent = detail.title;
  detailPanel.style.borderLeftColor = detail.accent === undefined
    ? 'var(--cp-accent)'
    : `#${detail.accent.toString(16).padStart(6, '0')}`;

  const rows: HTMLElement[] = [];
  for (const field of detail.fields) {
    const term = document.createElement('dt');
    term.textContent = field.label;
    const value = document.createElement('dd');
    value.textContent = field.value;
    rows.push(term, value);
  }
  if (rows.length === 0) {
    const value = document.createElement('dd');
    value.textContent = 'Die Quelle liefert zu diesem Eintrag keine weiteren Angaben.';
    rows.push(value);
  }
  detailFields.replaceChildren(...rows);
  detailSource.textContent = `Quelle: ${detail.source}`;
  detailPanel.hidden = false;
  detailPanel.scrollTop = 0;
  offerNote(detail);
}

// ------------------------------------------------------------------ Koordinationsnotiz
const noteActions = document.querySelector<HTMLElement>('#detail-actions')!;
const noteButton = document.querySelector<HTMLButtonElement>('#detail-note')!;
const noteForm = document.querySelector<HTMLFormElement>('#note-form')!;
const noteKategorie = document.querySelector<HTMLSelectElement>('#note-kategorie')!;
const noteText = document.querySelector<HTMLTextAreaElement>('#note-text')!;
const noteCancel = document.querySelector<HTMLButtonElement>('#note-cancel')!;
const noteSave = document.querySelector<HTMLButtonElement>('#note-save')!;
const noteStatus = document.querySelector<HTMLElement>('#note-status')!;

/** The Baustelle the open panel describes, if it is one. */
let noteTarget: PickDetail | null = null;

/**
 * Offer to write a note, but only on a construction site.
 *
 * ⚠️ NOT ON THE OFFICIAL AIR-QUALITY OR FLIGHT LAYERS. A note is an annotation this app owns; the
 * measuring stations and the aircraft belong to their operators and there is nothing here for a
 * user to coordinate. Offering the button everywhere would invite the reading that anything on
 * this map can be edited.
 */
function offerNote(detail: PickDetail | null) {
  noteForm.hidden = true;
  noteStatus.textContent = '';
  const eligible = detail?.layerId === 'baustellen' && Boolean(detail.baustelleId);
  noteTarget = eligible ? detail : null;
  noteActions.hidden = !eligible;
}

noteButton.addEventListener('click', () => {
  noteForm.hidden = false;
  noteActions.hidden = true;
  noteText.value = '';
  noteStatus.textContent = '';
  noteText.focus();
});

noteCancel.addEventListener('click', () => {
  noteForm.hidden = true;
  noteActions.hidden = !noteTarget;
});

noteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const target = noteTarget;
  const text = noteText.value.trim();
  if (!target || !target.baustelleId || !text) {
    noteStatus.textContent = 'Bitte einen Text eingeben.';
    return;
  }
  noteSave.disabled = true;
  noteStatus.textContent = 'Wird gespeichert…';
  void createNote({
    baustelleId: target.baustelleId,
    ort: target.title,
    easting: target.easting ?? null,
    northing: target.northing ?? null,
    kategorie: noteKategorie.value,
    text,
  }).then(() => {
    noteStatus.textContent = author()
      ? `Gespeichert, erfasst als ${author()} (gemeldet).`
      : 'Gespeichert. Es konnte keine angemeldete Person ermittelt werden.';
    noteForm.hidden = true;
    noteActions.hidden = false;
    // The layer reloads so the new pin appears at once rather than on the next poll.
    void koordinationLayer?.refresh();
  }).catch((error: unknown) => {
    noteStatus.textContent = `Nicht gespeichert: ${error instanceof Error ? error.message : 'unbekannter Fehler'}`;
  }).finally(() => {
    noteSave.disabled = false;
  });
});

// ------------------------------------------------------------------ layer panel
/**
 * A layer is only constructed the first time it is switched on.
 *
 * ⚠️ DELIBERATE, NOT LAZINESS. Every layer here opens a connection to a third-party endpoint, and
 * all of them are public services run by other people. An app that fires them all on page load —
 * including on every reload during a rehearsal — is rude and, on a hosted app whose CSP has never
 * been proven, produces a screenful of console failures before the user has asked for anything.
 */
/**
 * ⚠️ A STRING, NOT A UNION, SINCE THE CATALOGUE ARRIVED. The six hand-written layers
 * (flugverkehr, baustellen, mvg, luft-amtlich, luft-buerger, koordination) each have their own
 * module. The open-data layers are data: widening the type is what lets a new dataset be one
 * entry in `wfsCatalogue.ts` instead of an edit in four files. `wireLayers` still refuses any
 * checkbox with no factory behind it, so an unknown id cannot slip through unnoticed.
 */
type LayerId = string;

type LayerFactory = (world: WorldMap, onStatus: (status: LiveStatus) => void) => Promise<void>;

const factories: Record<LayerId, LayerFactory> = {
  flugverkehr: async (world, onStatus) =>
    world.registerLayer(await createFlugverkehrLayer({
      placement: world.placement, onStatus, signal: world.signal,
    })),
  baustellen: async (world, onStatus) =>
    world.registerLayer(await createBaustellenLayer({ placement: world.placement, onStatus })),
  mvg: async (world, onStatus) =>
    world.registerLayer(await createMvgLayer({
      placement: world.placement,
      onStatus,
      // Only ten stops are polled on a timer, so a click on any other stop has nothing to show
      // at the moment of the click. This lets the layer push the answer in when it arrives.
      onDetail: (detail) => showDetail(detail),
    })),
  fahrzeuge: async (world, onStatus) =>
    world.registerLayer(await createFahrzeugeLayer({ placement: world.placement, onStatus })),
  'luft-amtlich': async (world, onStatus) =>
    world.registerLayer(await createLuftAmtlichLayer({
      placement: world.placement,
      onStatus,
      // Frame the stations the first time they are drawn. Without this the layer switches on,
      // reports five stations and shows an empty view, because none of them happen to fall in
      // the default camera's frame.
      //
      // The 6 km preference keeps the city view when the user is on München Zentrum: the three
      // inner stations are about 2.5 km apart, while Allach and Johanneskirchen sit 13 km out
      // and would otherwise drag the camera to 16 km up.
      // Frame the stations the first time they are drawn. Without this the layer switches on,
      // reports five stations and shows an empty view, because none of them happen to fall in
      // the default camera's frame.
      //
      // ⚠️ 4 km, AND THE NUMBER IS MEASURED. Horizontal distance from the default München target
      // to each station: 1838, 1920, 3224, 5667 and 9252 m. A 6 km preference pulled in
      // Johanneskirchen at 5667 m and pushed the camera to 13.7 km altitude, which frames five
      // columns and no city. At 4 km the three inner stations are framed from about 4 km up,
      // and those three are the interesting comparison anyway: two Verkehr stations and one
      // Hintergrund station within 3 km of each other.
      onFirstDraw: (points) => world.flyToPoints(points, 4000),
      onSelectionStale: () => world.clearPick(),
    })),
  'luft-buerger': async (world, onStatus) =>
    world.registerLayer(await createLuftBuergerLayer({
      placement: world.placement,
      onStatus,
      onSelectionStale: () => world.clearPick(),
    })),
  koordination: async (world, onStatus) => {
    const layer = await createKoordinationLayer({
      placement: world.placement,
      onStatus,
      onSelectionStale: () => world.clearPick(),
    });
    koordinationLayer = layer;
    world.registerLayer(layer);
  },
};

// Every measured open dataset becomes a layer without a line of layer-specific code. This is the
// whole point of the catalogue: the engine handles point, line and polygon, so extending the app
// to another dataset of the Landeshauptstadt is an entry, not a module.
for (const spec of WFS_LAYERS) {
  factories[spec.id] = async (world, onStatus) =>
    world.registerLayer(await createWfsLayer(spec, { placement: world.placement, onStatus }));
}

/**
 * Build the catalogue's checkboxes from the catalogue itself.
 *
 * ⚠️ NOT HAND-WRITTEN IN index.html. With a dozen datasets today and sixty available, keeping
 * the markup in step with the catalogue by hand guarantees the two drift: a checkbox whose id no
 * longer has a factory disables itself silently, and a catalogue entry with no checkbox simply
 * never appears. Generated from one source, neither can happen.
 */
function renderCatalogueGroups() {
  const host = document.querySelector<HTMLElement>('#layer-groups');
  if (!host || host.dataset.rendered === 'true') return;
  for (const { group, layers } of groupedLayers()) {
    const details = document.createElement('details');
    details.className = 'layer-group';
    const summary = document.createElement('summary');
    summary.textContent = `${group} (${layers.length})`;
    details.append(summary);

    const list = document.createElement('ul');
    for (const spec of layers) {
      const item = document.createElement('li');
      const label = document.createElement('label');

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.layer = spec.id;

      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = spec.label;

      const source = document.createElement('span');
      source.className = 'layer-source';
      // Say where it comes from and, for points, that the marker is a symbol rather than a model.
      source.textContent = spec.geometry === 'point'
        ? `${spec.source} · Markierungen sind Symbole`
        : spec.source;

      label.append(input, name, source);

      const state = document.createElement('span');
      state.className = 'layer-state';
      state.dataset.stateFor = spec.id;
      state.textContent = 'aus';

      item.append(label, state);
      list.append(item);
    }
    details.append(list);
    host.append(details);
  }
  host.dataset.rendered = 'true';
}

/**
 * The notes layer, once built.
 *
 * Kept so that saving a note can refresh the map immediately. Without it a note appears only on
 * the next poll, and a person who just pressed Speichern reasonably concludes it was not saved.
 */
let koordinationLayer: KoordinationLayer | null = null;

const built = new Set<LayerId>();

function setLayerState(id: LayerId, status: LiveStatus) {
  const label = layerPanel.querySelector<HTMLElement>(`[data-state-for="${id}"]`);
  if (!label) return;
  label.textContent = status.text;
  label.dataset.state = status.state;
}

function wireLayers(world: WorldMap) {
  renderCatalogueGroups();
  for (const input of layerPanel.querySelectorAll<HTMLInputElement>('input[data-layer]')) {
    const id = input.dataset.layer as LayerId;
    const factory = factories[id];
    if (!factory) {
      // A checkbox with nothing behind it would silently do nothing, which is worse than not
      // offering it at all. Disable it and say so.
      input.disabled = true;
      setLayerState(id, { ...idleStatus(), text: 'nicht enthalten' });
      continue;
    }
    setLayerState(id, idleStatus());
    input.addEventListener('change', () => {
      void (async () => {
        if (input.checked && !built.has(id)) {
          input.disabled = true;
          setLayerState(id, { state: 'loading', text: 'wird vorbereitet…', fetchedAt: null, count: 0 });
          try {
            await factory(world, (status) => setLayerState(id, status));
            built.add(id);
          } catch (error) {
            input.checked = false;
            setLayerState(id, {
              state: 'error',
              text: error instanceof Error ? error.message : 'Ebene nicht verfügbar',
              fetchedAt: null, count: 0,
            });
            return;
          } finally {
            input.disabled = false;
          }
        }
        world.setLayerVisible(id, input.checked);
      })();
    });
  }
}

// ------------------------------------------------------------------ site switch
function wireSwitcher(world: WorldMap) {
  const buttons = [...switcher.querySelectorAll<HTMLButtonElement>('button[data-site]')];
  const paint = (active: string) => {
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.site === active));
    }
  };
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const id = button.dataset.site;
      if (id) world.flyToSite(id);
    });
  }
  world.onSiteChange((id) => {
    paint(id);
    // Deep link, so either site can be opened directly rather than clicked to during a demo.
    const url = new URL(window.location.href);
    url.searchParams.set('ort', id);
    window.history.replaceState({}, '', url);
    const site = SITES.find((entry) => entry.id === id);
    if (site) document.title = `München Zwilling · ${site.name}`;
  });
  paint(world.activeSite);
}

// ------------------------------------------------------------------ start
void createWorldMap(canvas, (update) => {
  if (closed) return;
  const mb = (update.loadedBytes / 1048576).toFixed(1);
  detail.textContent = `${stages[update.stage] ?? update.stage} · ${mb} MB`;
  if (update.totalBytes > 0) {
    progress.max = update.totalBytes;
    progress.value = update.loadedBytes;
  } else progress.removeAttribute('value');
}, (telemetry) => {
  if (closed) return;
  hud.hidden = !telemetry.engaged;
  hint.hidden = telemetry.engaged;
  if (!telemetry.engaged) return;
  const agl = telemetry.aglM === null ? '?' : Math.round(telemetry.aglM);
  hud.textContent = `Höhe ${Math.round(telemetry.altitudeM)} m · über Grund ${agl} m · `
    + `${Math.round(telemetry.speedMs)} m/s · Kurs ${Math.round(telemetry.headingDeg)}° · Esc zum Loslassen`;
}, requestedSiteId(window.location.search), loadingRequest.signal).then((created) => {
  if (closed) { created.dispose(); return; }
  map = created;
  window.__zwilling = () => created.debug();
  created.onPick(showDetail);
  wireSwitcher(created);
  wireLayers(created);

  // ⚠️ The assistant is wired only once the map exists, because saving a note refreshes a layer.
  const chat = wireChat({
    onNoteSaved: () => { void koordinationLayer?.refresh(); },
    onSignIn: async () => {
      const name = await entraSignIn();
      setAuthor(name);
      if (name) chat.setAuthorNote(await authorNoteFor(name));
      return name;
    },
  });
  document.querySelector<HTMLElement>('#assistant-toggle')!.hidden = false;

  // A note somebody else published is not pushed to this browser, so the layer offers an explicit
  // reload. Shown only while the layer is on, because a button that reloads an invisible layer
  // would do nothing a user could see.
  const refreshButton = document.querySelector<HTMLButtonElement>('#koordination-refresh');
  if (refreshButton) {
    const syncVisibility = () => {
      const box = document.querySelector<HTMLInputElement>('input[data-layer="koordination"]');
      refreshButton.hidden = !box?.checked;
    };
    syncVisibility();
    document.querySelector<HTMLInputElement>('input[data-layer="koordination"]')
      ?.addEventListener('change', syncVisibility);
    refreshButton.addEventListener('click', () => {
      refreshButton.disabled = true;
      refreshButton.textContent = 'Lädt …';
      void Promise.resolve(koordinationLayer?.refresh()).finally(() => {
        refreshButton.disabled = false;
        refreshButton.textContent = 'Neu laden';
      });
    });
  }

  // Identity is best-effort and must never block the map. A failure leaves the note unattributed
  // and says so, rather than inventing a name.
  //
  // ⚠️ SILENT ONLY AT STARTUP. Opening a sign-in window while the map is still assembling would
  // land a popup on top of the scene, so an existing session is reused and anything else waits
  // for a deliberate click on the button.
  void (async () => {
    const name = await entraAccount();
    setAuthor(name);
    if (!name) {
      chat.setAuthorNote('Noch keine angemeldete Person ermittelt. Notizen werden sonst ohne Namen gespeichert.');
      chat.offerSignIn(true);
      return;
    }
    chat.setAuthorNote(await authorNoteFor(name));
    // Still offer signing in again when the cached account cannot actually produce a token,
    // otherwise the only route back to a verified author is a manual cache clear.
    chat.offerSignIn(!(await entraToken()));
  })();

  loading.hidden = true;
  controls.hidden = false;
  switcher.hidden = false;
  layerPanel.hidden = false;
  canvas.dataset.ready = 'true';
}).catch((error) => {
  if (closed) return;
  console.error(error);
  showError();
});
