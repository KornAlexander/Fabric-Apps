import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createWorldMap, type PickDetail, type WorldMap } from './map/worldScene';
import type { FlyTelemetry } from './map/flyControls';
import { requestedSiteId, worldSites, type SiteConfig, type WorldId } from './config/world';
import { PACK, brandName, packSites, packStartSite, type ConfigPack } from './config/activePack';
import type { KoordinationLayer } from './live/koordination';
import { createFactories } from './layers/factories';
import { setAuthor } from './agent/client';
import { account as entraAccount, signIn as entraSignIn, token as entraToken } from './agent/token';
import { getLanguage, later, setLanguage, show, t, type MessageKey, type Text } from './i18n';
import { useLanguage } from './i18n/useLanguage';
import { LayerPanel } from './ui/LayerPanel';
import { DetailPanel } from './ui/DetailPanel';
import { Assistant } from './ui/Assistant';
import { Attribution } from './ui/Attribution';

declare global {
  interface Window { __zwilling?: () => Record<string, unknown>; }
}

type Phase = 'loading' | 'ready' | 'error';

interface Progress {
  stage: string;
  loadedBytes: number;
  totalBytes: number;
}

/** A value outside React that one small component subscribes to, so 10 Hz updates stay local. */
function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

type TelemetryStore = ReturnType<typeof createStore<FlyTelemetry | null>>;

/**
 * Wording for the author line that matches what the server will actually see.
 *
 * ⚠️ A CACHED ACCOUNT IS NOT PROOF OF VERIFICATION. Reading an account out of the MSAL cache only
 * says somebody signed in at some point; it does not say a token can still be obtained, and
 * without a token the write is attributed but unverified. Ask for a token and let the answer
 * decide the sentence.
 */
async function authorNoteFor(name: string): Promise<Text> {
  const proven = Boolean(await entraToken());
  return proven ? later('author.verified', name) : later('author.unverified', name);
}

export function App({ pack = PACK }: { pack?: ConfigPack } = {}) {
  const lang = useLanguage();
  const sites = useMemo(() => packSites(pack), [pack]);
  // ⚠️ ONE CITY PER SCENE (see src/config/world.ts). The scene holds the active city's sites;
  // the switcher lists every city's. The start site is kept in a ref so that flying between two
  // sites of the same city does not rebuild the scene, while picking another city does.
  const startSite = useRef<string>('');
  if (!startSite.current) startSite.current = requestedSiteId(window.location.search, sites, packStartSite(pack, sites));
  const [worldId, setWorldId] = useState<WorldId>(
    () => sites.find((site) => site.id === startSite.current)?.world ?? sites[0].world);
  const sceneSites = useMemo(() => worldSites(worldId, sites), [worldId, sites]);
  const brand = show(brandName(pack));
  const canvas = useRef<HTMLCanvasElement>(null);
  const notes = useRef<KoordinationLayer | null>(null);
  const telemetry = useMemo(() => createStore<FlyTelemetry | null>(null), []);
  const [phase, setPhase] = useState<Phase>('loading');
  const [world, setWorld] = useState<WorldMap | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [detail, setDetail] = useState<PickDetail | null>(null);
  const [activeSite, setActiveSite] = useState<string | null>(null);
  const [authorNote, setAuthorNote] = useState<Text | null>(null);
  const [offerSignIn, setOfferSignIn] = useState(false);

  const factories = useMemo(() => createFactories({
    showDetail: setDetail,
    notesReady: (layer) => { notes.current = layer; },
  }, undefined, pack, worldId), [pack, worldId]);

  // ------------------------------------------------------------------ the scene's lifetime
  //
  // ⚠️ NO <StrictMode> AROUND THIS (see main.tsx). The scene owns a WebGL context on this canvas;
  // a mount-unmount-mount cycle would dispose it and immediately ask the same canvas for another.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let closed = false;
    let created: WorldMap | null = null;
    const request = new AbortController();

    const teardown = () => {
      closed = true;
      request.abort();
      created?.dispose();
      created = null;
      delete window.__zwilling;
      // A city switch tears the old world down before the next one exists: nothing may still
      // claim readiness, show the old flight readout or point at the old notes layer.
      delete element.dataset.ready;
      telemetry.set(null);
      notes.current = null;
    };
    const fail = () => {
      delete element.dataset.ready;
      setWorld(null);
      setDetail(null);
      setPhase('error');
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      teardown();
      fail();
    };
    const onPageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) teardown();
    };
    element.addEventListener('webglcontextlost', onContextLost);
    window.addEventListener('pagehide', onPageHide);

    void createWorldMap(element, (update) => {
      if (!closed) setProgress({ stage: update.stage, loadedBytes: update.loadedBytes, totalBytes: update.totalBytes });
    }, (next) => {
      if (!closed) telemetry.set(next);
    }, startSite.current, request.signal, sceneSites).then((map) => {
      if (closed) { map.dispose(); return; }
      created = map;
      window.__zwilling = () => map.debug();
      map.onPick(setDetail);
      map.onSiteChange((id) => {
        setActiveSite(id);
        // Deep link, so either site can be opened directly rather than clicked to during a demo.
        const url = new URL(window.location.href);
        url.searchParams.set('ort', id);
        window.history.replaceState(window.history.state, '', url);
      });
      setActiveSite(map.activeSite);
      setWorld(map);
      setPhase('ready');
      element.dataset.ready = 'true';
    }).catch((error: unknown) => {
      if (closed) return;
      console.error(error);
      fail();
    });

    return () => {
      element.removeEventListener('webglcontextlost', onContextLost);
      window.removeEventListener('pagehide', onPageHide);
      teardown();
    };
  }, [telemetry, sceneSites]);

  // The tab title names the brand and the site, in the current language.
  useEffect(() => {
    const site = sites.find((entry) => entry.id === activeSite);
    document.title = site ? `${brand} · ${show(site.name)}` : brand;
  }, [activeSite, lang, brand, sites]);

  // ⚠️ Escape closes the panel only while it is open. Escape also releases the free-flight
  // camera, and stealing it while flying would break the promise the on-screen hint makes.
  useEffect(() => {
    if (!detail || !world) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') world.clearPick(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail, world]);

  // ------------------------------------------------------------------ identity
  //
  // Best-effort and never blocks the map. ⚠️ SILENT ONLY AT STARTUP: an existing session is
  // reused, anything else waits for a deliberate click, so no popup lands on a half-built scene.
  useEffect(() => {
    if (phase !== 'ready') return;
    let cancelled = false;
    void (async () => {
      const name = await entraAccount();
      if (cancelled) return;
      setAuthor(name);
      // ⚠️ `() => text`, NOT `text`. A function handed to a state setter is run as an updater,
      // which would store today's string and freeze the line in the current language.
      if (!name) {
        setAuthorNote(() => later('author.none'));
        setOfferSignIn(true);
        return;
      }
      const note = await authorNoteFor(name);
      setAuthorNote(() => note);
      // Still offer signing in again when the cached account cannot produce a token, otherwise
      // the only route back to a verified author is a manual cache clear.
      setOfferSignIn(!(await entraToken()));
    })();
    return () => { cancelled = true; };
  }, [phase]);

  const onSignIn = async () => {
    const name = await entraSignIn();
    setAuthor(name);
    if (name) {
      const note = await authorNoteFor(name);
      setAuthorNote(() => note);
      setOfferSignIn(false);
    }
    return name;
  };

  const refreshNotes = async () => { await notes.current?.refresh(); };
  const ready = phase === 'ready' && world !== null;

  /** Same city: fly there. Another city: rebuild the scene around it, starting at that site. */
  const goTo = (site: SiteConfig) => {
    if (!world) return;
    if (site.world === worldId) { world.flyToSite(site.id); return; }
    startSite.current = site.id;
    const url = new URL(window.location.href);
    url.searchParams.set('ort', site.id);
    window.history.replaceState(window.history.state, '', url);
    setDetail(null);
    setWorld(null);
    setProgress(null);
    setPhase('loading');
    setWorldId(site.world);
  };

  return (
    <main id="map" aria-label={brand}>
      <canvas
        id="city-map"
        ref={canvas}
        tabIndex={0}
        aria-label={t('app.canvas')}
        aria-describedby="navigation-hint"
      />

      {phase === 'loading' ? <Loading progress={progress} brand={brand} /> : null}

      {phase === 'error' ? (
        <div id="error" role="alert">
          <strong>{t('error.title')}</strong>
          <p>{t('error.body')}</p>
          <button id="retry" type="button" onClick={() => window.location.reload()}>{t('error.retry')}</button>
        </div>
      ) : null}

      {ready ? (
        <>
          <div id="site-switch" role="group" aria-label={t('sites.label')}>
            {sites.map((site) => (
              <button
                key={site.id}
                type="button"
                data-site={site.id}
                aria-pressed={site.id === activeSite}
                onClick={() => goTo(site)}
              >
                <strong>{show(site.name)}</strong>
                <small>{show(site.subtitle)}</small>
              </button>
            ))}
          </div>

          <LayerPanel key={worldId} world={world} factories={factories} refreshNotes={refreshNotes} pack={pack} worldId={worldId} />

          {detail ? (
            <DetailPanel
              detail={detail}
              onClose={() => world.clearPick()}
              onNoteSaved={() => { void refreshNotes(); }}
            />
          ) : null}

          {/* ⚠️ MUNICH ONLY. The agent's tools (roadworks, notes, UBA stations) query Munich's
              services; offered in Hamburg it would answer about Munich and draft Munich notes. */}
          {worldId === 'munich' ? (
            <Assistant
              onNoteSaved={() => { void refreshNotes(); }}
              onSignIn={onSignIn}
              authorNote={authorNote}
              offerSignIn={offerSignIn}
            />
          ) : null}

          <nav id="map-controls" aria-label={t('controls.label')}>
            <button
              id="language"
              type="button"
              lang={lang === 'de' ? 'en' : 'de'}
              aria-label={t('controls.language')}
              title={t('controls.language')}
              onClick={() => setLanguage(getLanguage() === 'de' ? 'en' : 'de')}
            >
              {t('controls.languageShort')}
            </button>
            <button id="north" type="button" aria-label={t('controls.north')} title={t('controls.north')} onClick={() => world.faceNorth()}>N ↑</button>
            <button id="home" type="button" aria-label={t('controls.home')} title={t('controls.home')} onClick={() => world.reset()}>⌂</button>
          </nav>
        </>
      ) : null}

      {phase === 'error' ? null : <Navigation store={telemetry} />}

      <Attribution />
    </main>
  );
}

const STAGES: Record<string, MessageKey> = {
  terrain: 'loading.stage.terrain',
  drape: 'loading.stage.drape',
  buildings: 'loading.stage.buildings',
  vegetation: 'loading.stage.vegetation',
};

function Loading({ progress, brand }: { progress: Progress | null; brand: string }) {
  const stage = progress ? (STAGES[progress.stage] ? t(STAGES[progress.stage] as 'loading.stage.terrain') : progress.stage) : null;
  const known = progress !== null && progress.totalBytes > 0;
  return (
    <div id="loading" role="status" aria-live="polite">
      <strong>{t('loading.title', brand)}</strong>
      <span id="loading-detail">
        {progress ? `${stage} · ${(progress.loadedBytes / 1048576).toFixed(1)} MB` : t('loading.preparing')}
      </span>
      <progress
        id="progress"
        aria-label={t('loading.progress')}
        max={known ? progress.totalBytes : undefined}
        value={known ? progress.loadedBytes : undefined}
      />
      <small id="loading-note">{t('loading.note')}</small>
    </div>
  );
}

/**
 * The navigation hint, or the drone readout while the free-flight camera is engaged.
 *
 * Both stay in the DOM and swap with `hidden`, because the canvas names the hint as its
 * description and a removed element would leave that reference dangling.
 */
function Navigation({ store }: { store: TelemetryStore }) {
  useLanguage();
  const telemetry = useSyncExternalStore(store.subscribe, store.get, store.get);
  const engaged = telemetry?.engaged === true;
  const agl = telemetry?.aglM == null ? '?' : String(Math.round(telemetry.aglM));
  return (
    <>
      <div id="drone-hud" data-testid="drone-hud" hidden={!engaged}>
        {engaged && telemetry
          ? t('hud.flight', Math.round(telemetry.altitudeM), agl, Math.round(telemetry.speedMs), Math.round(telemetry.headingDeg))
          : null}
      </div>
      <p id="navigation-hint" hidden={engaged}>{t('hint.navigation')}</p>
    </>
  );
}
