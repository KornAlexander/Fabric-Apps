import { useState } from 'react';

import aoi from '@config/aoi/ahrtal-2021.json';
import castelbolognese from '@config/aoi/castelbolognese-2023.json';
import hortasud from '@config/aoi/hortasud-2024.json';
import steinbach from '@config/aoi/steinbach-2021.json';
import { useI18n } from '@/i18n';
import { ClosingProvider, useClosing } from '@/state/closing';
import { attributionFor } from '@/twin3d/attribution';
import { resolveInitialScene, type SceneEntry } from '@/twin3d/scenes';

import { LanguageToggle } from './LanguageToggle';
import { ReachScene } from './ReachScene';
import { SceneSwitch } from './SceneSwitch';
import { SteinbachScene } from './SteinbachScene';
import { SteinbachPanel } from './SteinbachPanel';
import { Twin3DView } from './Twin3DView';

const STORAGE_KEY = 'flut-insights.scene';

/**
 * Which grid each reach scene was built on, read from the AOI configs.
 *
 * ⚠️ These were literals, and they went stale within a day. Horta Sud was rebuilt from 5 m to
 * 10 m to fit the deploy limit, and its flow field from 10 m to 20 m; the config was updated and
 * this map was not, so the browser asked for heightmap_5m.json, got a 404, and the scene showed
 * "could not be loaded" — while Castel Bolognese, whose numbers happened not to change, kept
 * working. A wrong number here does not mislead, it 404s, which is the good failure mode; but it
 * only fails in the browser, after a deploy, which is the bad one.
 *
 * The resolutions are a property of how the AOI was built, and the AOI config is where that is
 * recorded, so read them from there and they cannot disagree.
 */
const REACH_GRIDS: Record<string, { terrain: number; flow: number }> = {
  'hortasud-2024': {
    terrain: hortasud.grids.terrainResolutionM,
    flow: hortasud.grids.flowResolutionM,
  },
  'castelbolognese-2023': {
    terrain: castelbolognese.grids.terrainResolutionM,
    flow: castelbolognese.grids.flowResolutionM,
  },
};

export function TwinShell() {
  return (
    <ClosingProvider>
      <TwinShellInner />
    </ClosingProvider>
  );
}

function TwinShellInner() {
  const { t, locale } = useI18n();
  const { setOpen: setClosingOpen } = useClosing();
  // URL first so a scene is shareable, then the last choice, then the default — the precedence
  // Airport IQ's airport switch uses. Resolved once; the switch below owns it after that.
  const [scene, setScene] = useState<SceneEntry>(() =>
    resolveInitialScene(
      typeof window === 'undefined' ? '' : window.location.search,
      typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY)
    )
  );

  const selectScene = (next: SceneEntry) => {
    setScene(next);
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, next.id);
    // replaceState, not pushState: the link stays shareable but the back button does not have to
    // walk every switch the viewer made.
    const url = new URL(window.location.href);
    url.searchParams.set('scene', next.id);
    window.history.replaceState(null, '', url);
  };

  // The reach, not a roll-call. This used to join every focus place with a separator, which read
  // fine at four and wrapped the header onto a second line at thirteen. The full list is the
  // village rail's job; the header only has to say which stretch of river this is.
  const first = aoi.focusPlaces[0]?.name;
  const last = aoi.focusPlaces[aoi.focusPlaces.length - 1]?.name;
  const places = first && last && first !== last ? `${first} – ${last}` : (first ?? '');
  const isValley = scene.kind === 'valley';

  // ⚠️ The header described the Ahr on every scene, because `aoi` above is a static import of the
  // Ahr's config and the subtitle was a fixed string. On the Italian reach it read "Ahrtal,
  // 14./15. Juli 2021" over a map of Emilia-Romagna. Each scene names itself instead.
  const sceneAoi = { 
    'ahrtal-2021': aoi,
    'steinbach-2021': steinbach,
    'hortasud-2024': hortasud,
    'castelbolognese-2023': castelbolognese,
  }[scene.id];
  const eventName = sceneAoi?.event?.name?.[locale] ?? '';

  return (
    <main
      data-testid="twin-shell"
      className="flex h-screen w-full flex-col overflow-hidden bg-stone-100 text-stone-700"
    >
      <header className="flex flex-wrap items-baseline gap-3 border-b border-stone-300 bg-stone-50 px-6 py-4">
        <h1 className="text-sm font-semibold tracking-wide text-stone-900">{t('app.title')}</h1>
        <span className="text-xs text-stone-500">
          {isValley ? t('app.subtitle') : t(scene.labelKey)}
        </span>
        <span className="ml-auto hidden text-[0.7rem] uppercase tracking-[0.15em] text-stone-500 2xl:inline">
          {isValley ? `${aoi.event.name[locale]} · ${places}` : eventName}
        </span>
        {/*
          The map switch. The whole scene changes with it — the Ahr twin and the Steinbach
          corridor are separate renderers over separate terrain, so this swaps the view rather
          than moving a camera.
        */}
        <SceneSwitch value={scene} onChange={selectScene} />
        {/*
          `ml-auto` moved here from the reach caption, which now drops out below xl. Adding the
          map switch pushed the header onto two rows at 1320 px, and a wrapped header steals height
          from the map — the caption is the one item that can go without losing a way in.
        */}
        {/*
          The Steinbach reading, shown only while the corridor is the map.

          It used to sit here permanently, labelled "Steinbachtalsperre" — the same words as the
          dropdown entry directly to its left, so the header offered the same place twice, and the
          button vanished at exactly the moment you switched to the corridor and might want to
          read about it. Now it behaves like "Lehren und Quellen" does for the valley: background
          to the map you are looking at, available while you are looking at it.
        */}
        {!isValley && <SteinbachPanel />}
        {/*
          PLAN §9.0: the closing screen is reached at the end of the tour *and* is always
          available from the header. It is the bookend to the remembrance screen, not a footer
          link, so it sits next to the other two ways out of the map rather than below the fold.
        */}
        <button
          type="button"
          data-testid="closing-open"
          onClick={() => setClosingOpen(true)}
          className="rounded border border-stone-300 bg-stone-50 px-2 py-1 text-[0.7rem] text-stone-600 hover:bg-stone-200 hover:text-stone-900"
        >
          {t('closing.open')}
        </button>
        <LanguageToggle className="-my-1" />
      </header>

      {/*
        Keyed on the scene id so React remounts rather than reconciling. The two scenes own
        separate WebGL contexts, geometry and animation loops; reusing a mounted component across
        a switch would leak one of them. Airport IQ keeps a single renderer and swaps a container
        group, which is cheaper — but it draws one kind of thing. These two do not share a
        pipeline, so an honest unmount is the simpler correctness story.
      */}
      {isValley ? (
        <Twin3DView key={scene.id} />
      ) : scene.kind === 'reach' ? (
        <div data-testid="reach-view" className="min-h-0 flex-1 bg-stone-100">
          <ReachScene
            key={scene.id}
            aoiId={scene.id}
            terrainName={`heightmap_${REACH_GRIDS[scene.id].terrain}m`}
            flowName={`flowfield_${REACH_GRIDS[scene.id].flow}m`}
          />
        </div>
      ) : (
        <div data-testid="corridor-view" className="min-h-0 flex-1 bg-stone-100">
          <SteinbachScene key={scene.id} variant="full" />
        </div>
      )}

      <footer
        data-testid="attribution"
        className="border-t border-stone-300 bg-stone-50 px-6 py-3 text-[0.65rem] leading-relaxed text-stone-500"
      >
        <span className="mr-3 text-stone-600">{t('disclaimer.short')}</span>
        {attributionFor(scene.id).join(' · ')}
      </footer>
    </main>
  );
}
