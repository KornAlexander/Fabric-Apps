import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import aoi from '@config/aoi/ahrtal-2021.json';

import { dischargeAt, peakDischargeForScenario, timesHq100 } from '@/twin3d/hydrograph';
import { initTwin3D, type Twin3DHandle } from '@/twin3d/scene';
import {
  activeBeat,
  buildStoryBeats,
  peakMinutesByChainage,
  type StoryBeat,
} from '@/twin3d/storyBeats';
import { TerrainNotBuiltError, type LoadStageProgress } from '@/twin3d/terrainLoader';
import type { PortfolioBundle } from '@/twin3d/whatif';
import { DEFAULT_STORY_ID, storyById, type Story } from '@/twin3d/stories';
import {
  HOLD_MS,
  distanceBetween,
  flightMs,
  loadStory,
  saveStory,
  type Bookmark,
} from '@/twin3d/bookmarks';
import { hazardVersusEvent } from '@/twin3d/hazardVersusEvent';
import { useClosing } from '@/state/closing';
import { useI18n } from '@/i18n';

import { ActIVPanel } from './ActIVPanel';
import { BookmarkStory } from './BookmarkStory';
import { ClosingScreen } from './ClosingScreen';
import { DroneControl } from './DroneControl';
import { Compass } from './Compass';
import { TourOverlay } from './TourOverlay';
import { PlaceLabels } from './PlaceLabels';
import { SetupNotice } from './SetupNotice';
import { StoryCaption, StoryMarkers } from './StoryAnnotations';
import { ValidationPanel } from './ValidationPanel';

const T_MIN = -720; // 12 h before the peak
const T_MAX = 1440; // 24 h after

// The whole 36 h in a little under a minute. Slow enough to watch the water arrive and drain,
// which is the point of Act II, and far too slow to feel like a fast-forward button. This is the
// 1x rate the speed control multiplies.
const PLAYBACK_MINUTES_PER_SECOND = 40;

/**
 * Playback multipliers, as discrete steps rather than a continuous range.
 *
 * A free-running slider invites rates that are of no use to anybody — fast enough that the wave
 * crosses the valley between two frames, or so slow the water appears static. Five stops keep
 * every position meaningful: a quarter speed to watch one village fill, four times to get to the
 * recession without waiting.
 */
const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
const DEFAULT_SPEED_INDEX = 2; // 1x

function formatSpeed(multiplier: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    maximumFractionDigits: 2,
  }).format(multiplier);
}

/**
 * The instant the timeline is anchored to, from the AOI config (§14 Q2 — no location or date is
 * hard-coded here).
 *
 * ⚠️ This is an assumption, not a measurement. The Altenahr gauge was destroyed at 20:45 with
 * 575 cm on the board, so the peak was never timed. See `$peakComment` in the config and the note
 * on the peak annotation.
 */
const PEAK_EPOCH_MS = Date.parse(aoi.event.peakUtc);

function formatClock(tMinutes: number, locale: string): string {
  const stamp = new Date(PEAK_EPOCH_MS + tMinutes * 60000);
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(stamp);
}

/**
 * How far through the current stage, or null when the size is unknown.
 *
 * Unknown is a real case rather than a defensive one: behind gzip or brotli the declared length
 * describes the compressed body while the stream delivers decompressed bytes, so no honest
 * percentage exists. The bar switches to an indeterminate pulse and the megabyte counter carries
 * the reassurance instead.
 */
function stagePercent(progress: LoadStageProgress | null): number | null {
  if (!progress || progress.totalBytes <= 0) return null;
  return Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100));
}

function formatLoaded(progress: LoadStageProgress | null, locale: string): string {
  if (!progress) return '';
  const format = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const mb = (bytes: number) => format.format(bytes / 1_048_576);
  return progress.totalBytes > 0
    ? `${mb(progress.loadedBytes)} / ${mb(progress.totalBytes)} MB`
    : `${mb(progress.loadedBytes)} MB`;
}

export function Twin3DView() {
  const { t, locale } = useI18n();
  const { setOpen: setClosingOpen } = useClosing();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<Twin3DHandle | null>(null);
  const [minutes, setMinutes] = useState(-360);
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(DEFAULT_SPEED_INDEX);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [progress, setProgress] = useState<LoadStageProgress | null>(null);
  const [places, setPlaces] = useState<{ id: string; name: string }[]>([]);
  const [activePlace, setActivePlace] = useState<string>('');
  const [portfolio, setPortfolio] = useState<PortfolioBundle | null>(null);
  const [showStory, setShowStory] = useState(true);
  const [showTrees, setShowTrees] = useState(true);
  /**
   * Whether the viewer is driving the camera. See `src/twin3d/flyControls.ts`.
   *
   * Mirrored from the scene rather than owned here: the latch flips by itself on a keypress and
   * and again a second after the last one, so this follows it through `onFreeFly`.
   */
  const [freeFly, setFreeFly] = useState(false);
  const [showLanduse, setShowLanduse] = useState(true);
  /**
   * The aerial photograph. Off by default — it is the heaviest thing in the scene and the
   * cartographic surface is what the rest of the interface was designed against.
   */
  const [showDrape, setShowDrape] = useState(false);
  const [hasDrape, setHasDrape] = useState(false);
  /**
   * Photorealistic rendering: the aerial photograph, and a sharp window of it under the camera.
   *
   * A mode rather than a layer. It is a composition of things that already exist — drape on, land
   * cover off, high-resolution detail tiles following the view — and it moves their switches with
   * it, because a button that says "Landnutzung" while the map shows a photograph is worse than
   * no button.
   *
   * Off by default for the reason the drape is: the detail tiles are 3–5 MB each and nobody who
   * does not ask for this should download one.
   */
  const [photoreal, setPhotoreal] = useState(false);
  const [hasDetail, setHasDetail] = useState(false);
  // Off by default. It answers a different question from the rest of the twin — what was knowable
  // beforehand, rather than what happened — so it should be something the viewer asks for.
  const [showHazard, setShowHazard] = useState(false);
  const [exaggerated, setExaggerated] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);
  // The village rail folds on its own control. It answers "where", the timeline answers "when",
  // and collapsing one should not take the other with it.
  const [placesOpen, setPlacesOpen] = useState(true);
  /** Index of the current tour step, or -1 when no tour is running. */
  const [tourStep, setTourStep] = useState(-1);
  /** Which preset is running. Kept next to the index because the two only mean anything together. */
  const [tourStory, setTourStory] = useState<Story>(() => storyById(DEFAULT_STORY_ID));
  const [beats, setBeats] = useState<StoryBeat[]>([]);
  /** The presenter's own saved stops, restored from the last session. */
  const [story, setStory] = useState<Bookmark[]>(() =>
    typeof window === 'undefined' ? [] : loadStory(window.localStorage)
  );
  const [storyOpen, setStoryOpen] = useState(true);
  /** Index of the stop being played, or -1 when the story is not running. */
  const [storyIndex, setStoryIndex] = useState(-1);

  const loadingPercent = stagePercent(progress);
  const speed = PLAYBACK_SPEEDS[speedIndex];

  useEffect(() => {
    fetch('/terrain/ahrtal-2021/portfolio.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setPortfolio)
      .catch(() => setPortfolio(null));
  }, []);

  useEffect(() => {
    let disposed = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    initTwin3D(canvas, 'ahrtal-2021', (update) => {
      if (!disposed) setProgress(update);
    })
      .then((handle) => {
        if (disposed) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
        // The latch flips on its own — W takes the camera, a second of nothing gives it back —
        // so the toggle has to follow the scene rather than command it. Without this the button
        // would say "off" while the viewer was flying, which is worse than having no button.
        handle.onFreeFly(setFreeFly);
        handle.setTime(minutes);
        const focus = handle.assets.terrain.focusPlaces.map((p) => ({
          id: p.id,
          name: p.name,
        }));
        setPlaces(focus);
        // Must match the scene's opening frame, or the highlighted village is not the one the
        // camera is looking at.
        setActivePlace(focus[Math.floor(focus.length / 2)]?.id ?? focus[0]?.id ?? '');
        setReady(true);
      })
      .catch((err: unknown) => {
        if (err instanceof TerrainNotBuiltError) {
          setNeedsSetup(true);
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      disposed = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
    // Intentionally mount-only: the scene owns its own lifecycle and is driven through the handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handleRef.current?.setTime(minutes);
  }, [minutes]);

  // The trees are the cheapest thing in the scene to turn off, which makes this the useful escape
  // hatch on a weak machine as well as a way to see the bare landform.
  useEffect(() => {
    handleRef.current?.setVegetationVisible(showTrees);
  }, [showTrees, ready]);

  // Turning the land cover off returns the terrain to pure elevation shading, which is the honest
  // view of what the simulation actually runs on — the cover is colour and nothing else.
  useEffect(() => {
    handleRef.current?.setLanduseVisible(showLanduse);
  }, [showLanduse, ready]);

  // Whether there is a photograph at all is a property of the AOI, not of the app, so it is read
  // from the scene once it exists rather than assumed from the scene id.
  useEffect(() => {
    setHasDrape(handleRef.current?.hasDrape ?? false);
    setHasDetail(handleRef.current?.hasDetail ?? false);
  }, [ready]);

  useEffect(() => {
    handleRef.current?.setHazardVisible(showHazard);
  }, [showHazard, ready]);

  // Off by default: the terrain is drawn at true scale. Exaggeration is a distortion, so it is
  // something the viewer asks for and is told about, not the state they are handed.
  useEffect(() => {
    handleRef.current?.setVerticalExaggeration(exaggerated ? 1.5 : 1);
  }, [exaggerated, ready]);

  // Playback advances real time into simulated time. Driven by rAF rather than an interval so the
  // water level moves with the frames instead of stepping, and so it stops when the tab is hidden.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = performance.now();
    const step = (now: number) => {
      const elapsedSeconds = (now - previous) / 1000;
      previous = now;
      // Clamped here rather than left to the stop effect below: a frame callback already queued
      // when playback stops still lands its update, which used to leave the clock a minute past
      // the end of the record.
      setMinutes((current) =>
        Math.min(T_MAX, current + elapsedSeconds * PLAYBACK_MINUTES_PER_SECOND * speed)
      );
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // Changing speed restarts the loop, which is harmless: `previous` is reset to the current
    // timestamp, so no simulated time is lost or double-counted across the change.
  }, [playing, speed]);

  // Stop at the end of the record. It does not loop: the flood was not a loop, and leaving it
  // running back to the beginning would make it one (PLAN §2.3).
  useEffect(() => {
    if (playing && minutes >= T_MAX) {
      setMinutes(T_MAX);
      setPlaying(false);
    }
  }, [playing, minutes]);

  const atEnd = minutes >= T_MAX;

  // Beats are derived from the simulation, so they can only be worked out once both the flow field
  // and the portfolio are loaded. Doing it once here keeps it off the playback path.
  useEffect(() => {
    const handle = handleRef.current;
    if (!ready || !portfolio || !handle) return;
    const { flow } = handle.assets;
    setBeats(
      buildStoryBeats(
        {
          portfolio,
          bedProfileM: flow.bedProfileM,
          ratingDischargeM3s: flow.ratingDischargeM3s,
          ratingStageM: flow.ratingStageM,
          peakM3s: peakDischargeForScenario(),
          reachLengthM: flow.riverLengthKm * 1000,
        },
        { tMin: T_MIN, tMax: T_MAX }
      )
    );
  }, [ready, portfolio]);

  const currentBeat = useMemo(
    () => (showStory ? activeBeat(beats, minutes) : null),
    [showStory, beats, minutes]
  );

  // When the peak passes each village. Stated per village because the stagger along the reach is
  // real but small against a 36-hour timeline, so scrubbing alone makes it look simultaneous.
  //
  // Keyed by place id and derived from each place's own position on the reach. It used to come
  // from the median chainage of the buildings filed under a village name, which only worked while
  // there were four names to file them under; every settlement the map draws can now state its
  // own time.
  const villagePeak = useMemo(() => {
    const handle = handleRef.current;
    if (!ready || !handle) return new Map<string, number>();
    const { flow } = handle.assets;
    return peakMinutesByChainage(
      handle.placeChainage,
      flow.riverLengthKm * 1000,
      flow.chainagePoints
    );
  }, [ready]);

  /**
   * How long the peak takes to travel the whole modelled reach.
   *
   * This is the one number the place list holds but never states. Every row answers "when did it
   * reach here"; the distance between the first row and the last answers "how much time did the
   * valley have", which is the question Act IV is built on — and it only became legible once the
   * map ran all the way down to the mouth, because a reach that stops in mid-valley cannot show
   * how far ahead of the water the lower villages were.
   *
   * Derived from the same modelled peaks as the rows, so it inherits their caveat rather than
   * making a claim of its own.
   */
  const valleySpan = useMemo(() => {
    const timed = places
      .map((place) => ({ place, minutes: villagePeak.get(place.id) }))
      .filter((entry): entry is { place: (typeof places)[number]; minutes: number } =>
        entry.minutes !== undefined
      );
    if (timed.length < 2) return null;
    const first = timed.reduce((a, b) => (b.minutes < a.minutes ? b : a));
    const last = timed.reduce((a, b) => (b.minutes > a.minutes ? b : a));
    // Floor each end before subtracting, not the difference afterwards. The modelled peaks are
    // fractional minutes and the rows render them through a clock, which truncates; taking the
    // raw difference produced "3 Std. 8,58 Min." and, once rounded, a span that could disagree by
    // a minute with the two times sitting directly above it.
    const total = Math.floor(last.minutes) - Math.floor(first.minutes);
    if (total <= 0) return null;
    return {
      from: first.place.name,
      to: last.place.name,
      hours: Math.floor(total / 60),
      minutes: total % 60,
    };
  }, [places, villagePeak]);

  /**
   * Apply a tour step to the map.
   *
   * Steps only set what they name: a step that says nothing about the hazard layer leaves it as
   * the user left it. That matters because a presenter will touch the map mid-tour, and having
   * the next step silently undo their change would be worse than the tour not helping at all.
   */
  const applyTourStep = useCallback(
    (index: number, story: Story) => {
      const step = story.steps[index];
      if (!step) return;
      setPlaying(false);
      if (step.minutes !== undefined) setMinutes(step.minutes);
      if (step.layers?.hazard !== undefined) setShowHazard(step.layers.hazard);
      if (step.layers?.landuse !== undefined) setShowLanduse(step.layers.landuse);
      if (step.layers?.trees !== undefined) setShowTrees(step.layers.trees);
      if (step.place) {
        setActivePlace(step.place);
        handleRef.current?.focusPlace(step.place);
      }
    },
    []
  );
  const startTour = useCallback(() => {
    setTourStep(0);
    // Collapse the timeline for the duration. The tour card is already carrying the words, and
    // the expanded panel adds a nine-line caveat directly under it — on a 900 px screen the two
    // together took the middle of the map, which a recording made obvious. Collapsed is an
    // existing, sanctioned state rather than a new one: it keeps the scrubber, the clock and the
    // beat caption, and swaps the long notice for `twin.modelNoticeShort`, so PLAN §2.2 rule 3
    // still travels with the picture.
    setTimelineOpen(false);
    // A tour drives the camera, so it has to take it back first. Starting one is an explicit
    // request to be shown around; leaving free-fly on would mean the steps flew somewhere and the
    // viewer's keys immediately pulled the camera off it.
    setFreeFly(false);
    handleRef.current?.setFreeFly(false);
    applyTourStep(0, tourStory);
  }, [applyTourStep, tourStory]);

  /**
   * Switch preset mid-run. Restarts at step 0 of the new story: the stories have different
   * lengths and no shared step index, so carrying the old index across would land the viewer
   * somewhere arbitrary.
   */
  const pickStory = useCallback(
    (next: Story) => {
      setTourStory(next);
      setTourStep(0);
      applyTourStep(0, next);
    },
    [applyTourStep]
  );

  // ── The presenter's own story ────────────────────────────────────────────
  // Same idea as the tour, authored by whoever is presenting. Capture takes the map exactly as it
  // stands; playback flies between the stops slowly enough that the valley between them reads.

  const persist = useCallback((next: Bookmark[]) => {
    setStory(next);
    if (typeof window !== 'undefined') saveStory(window.localStorage, next);
  }, []);

  const captureStop = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const view = handle.getViewpoint();
    setStory((current) => {
      const next: Bookmark[] = [
        ...current,
        {
          id: `stop-${Date.now().toString(36)}`,
          // Named after the village in shot. The moment is not in the label because the row
          // already shows it in its own column, the way the village rail shows a peak time.
          label: places.find((p) => p.id === activePlace)?.name ?? t('bookmarks.title'),
          minutes,
          position: { x: view.position.x, y: view.position.y, z: view.position.z },
          target: { x: view.target.x, y: view.target.y, z: view.target.z },
          layers: {
            hazard: showHazard,
            landuse: showLanduse,
            trees: showTrees,
            exaggerated,
          },
        },
      ];
      if (typeof window !== 'undefined') saveStory(window.localStorage, next);
      return next;
    });
  }, [
    activePlace,
    exaggerated,
    minutes,
    places,
    showHazard,
    showLanduse,
    showTrees,
    t,
  ]);

  /**
   * Put the map back the way a stop found it, and travel there.
   *
   * The clock and the layers snap; only the camera flies. Easing the clock during the flight was
   * tempting and is the wrong default — a stop says "this is the moment", and a viewer watching
   * the water move while the camera moves cannot tell which of the two is the point.
   */
  const applyStop = useCallback((stop: Bookmark, durationMs: number) => {
    const handle = handleRef.current;
    setPlaying(false);
    setMinutes(stop.minutes);
    setShowHazard(stop.layers.hazard);
    setShowLanduse(stop.layers.landuse);
    setShowTrees(stop.layers.trees);
    setExaggerated(stop.layers.exaggerated);
    if (!handle) return;
    handle.flyToViewpoint({ position: stop.position, target: stop.target }, durationMs);
  }, []);

  /** How long the flight to `stop` should take, given where the camera stands now. */
  const flightTo = useCallback((stop: Bookmark) => {
    const handle = handleRef.current;
    if (!handle) return 0;
    const here = handle.getViewpoint();
    // Take whichever moved further. A stop that only changes the angle keeps the same target, and
    // pacing it off the target alone would give it no time at all.
    return flightMs(
      Math.max(
        distanceBetween(here.target, stop.target),
        distanceBetween(here.position, stop.position)
      )
    );
  }, []);

  const jumpToStop = useCallback(
    (index: number) => {
      const stop = story[index];
      if (!stop) return;
      setStoryIndex(-1);
      applyStop(stop, flightTo(stop));
    },
    [applyStop, flightTo, story]
  );

  const removeStop = useCallback(
    (id: string) => persist(story.filter((s) => s.id !== id)),
    [persist, story]
  );

  /**
   * Playback.
   *
   * One timer per stop rather than a single schedule computed up front: the flight time depends on
   * where the camera actually is when the step begins, and a viewer who grabs the map mid-story
   * has moved it. Recomputing per step keeps the pacing honest instead of drifting.
   */
  useEffect(() => {
    if (storyIndex < 0) return;
    const stop = story[storyIndex];
    if (!stop) {
      setStoryIndex(-1);
      return;
    }
    const travel = flightTo(stop);
    applyStop(stop, travel);
    const timer = window.setTimeout(() => {
      setStoryIndex((current) => {
        if (current < 0) return current;
        return current + 1 >= story.length ? -1 : current + 1;
      });
    }, travel + HOLD_MS);
    return () => window.clearTimeout(timer);
    // `story` is intentionally read but not a trigger: editing the list mid-playback should not
    // restart the current stop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyIndex]);

  const advanceTour = useCallback(
    (delta: number) => {
      setTourStep((current) => {
        const next = current + delta;
        // Running off the end is not "one more step" — it is the handover to the closing screen,
        // which is what PLAN §9.0 means by the tour ending there. Every story ends on Act IV, so
        // this is the same handover whichever preset is running.
        if (next >= tourStory.steps.length) {
          setClosingOpen(true);
          return -1;
        }
        const clamped = Math.max(0, next);
        applyTourStep(clamped, tourStory);
        return clamped;
      });
    },
    [applyTourStep, setClosingOpen, tourStory]
  );

  /**
   * The evidence that the hazard overlay is not the flood in different colours.
   *
   * A fair reading of the layer is that it must be, since both come out of the same terrain and
   * the same rating curve. Measured, it is not: the 2021 peak is roughly twice HQ100, so it
   * reaches a great deal of ground the hundred-year surface never touches — and close to a third
   * of what it floods is classified as flooding more rarely than that. The caveat says so with
   * the number rather than asking to be believed.
   */
  const hazardEvidence = useMemo(() => {
    const handle = handleRef.current;
    if (!ready || !handle || !portfolio) return null;
    const { flow } = handle.assets;
    const out = hazardVersusEvent({
      portfolio,
      bedProfileM: flow.bedProfileM,
      ratingDischargeM3s: flow.ratingDischargeM3s,
      ratingStageM: flow.ratingStageM,
      basePeakM3s: peakDischargeForScenario(),
      reachLengthM: flow.riverLengthKm * 1000,
    });
    const nf = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB');
    return {
      share: new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
        maximumFractionDigits: 0,
      }).format(out.shareBelowHq100Pct),
      low: nf.format(out.floodedBelowHq100Class),
      flooded: nf.format(out.flooded),
    };
  }, [ready, portfolio, locale]);

  const togglePlayback = () => {    if (playing) {
      setPlaying(false);
      return;
    }
    // Pressing play once it has run through starts again from the beginning.
    if (atEnd) setMinutes(T_MIN);
    setPlaying(true);
  };

  const peak = peakDischargeForScenario();
  const discharge = dischargeAt(minutes, peak);

  return (
    <div data-testid="twin3d-view" className="relative flex flex-1 flex-col">
      <canvas
        ref={canvasRef}
        data-testid="twin3d-canvas"
        data-ready={ready ? 'true' : 'false'}
        className="absolute inset-0 h-full w-full"
      />

      {error && (
        <div
          data-testid="twin3d-error"
          className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-amber-700"
        >
          {error}
        </div>
      )}

      {needsSetup && <SetupNotice />}

      {/* Place names over the map, once there is a map to put them on. */}
      {ready && <PlaceLabels getHandle={() => handleRef.current} />}

      {/*
        Roughly 48 MB has to arrive before there is anything to look at, and until it does the
        canvas is an empty pale rectangle that reads as a broken page rather than a loading one.
        The counter is deliberately in megabytes as well as percent: the percentage can sit on one
        number for seconds at a time on a slow link, and a figure that keeps moving is what
        actually distinguishes "still working" from "stuck".
      */}
      {!ready && !needsSetup && !error && (
        <div
          data-testid="twin3d-loading"
          data-stage={progress?.stage ?? 'starting'}
          role="status"
          aria-live="polite"
          className="absolute inset-0 flex items-center justify-center p-8"
        >
          <div className="w-full max-w-sm rounded border border-stone-300 bg-stone-50/90 p-5 shadow-sm backdrop-blur">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-sm font-semibold text-stone-800">{t('twin.loading')}</p>
              <p className="font-mono text-xs text-stone-500">
                {progress ? t('twin.loadingStep', { step: progress.step, of: progress.stepCount }) : ''}
              </p>
            </div>

            <p data-testid="twin3d-loading-stage" className="mt-1 text-xs text-stone-600">
              {progress ? t(`twin.loading_${progress.stage}`) : t('twin.loadingStart')}
            </p>

            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
              <div
                data-testid="twin3d-loading-bar"
                className={
                  loadingPercent === null
                    ? 'h-full w-1/3 animate-pulse rounded-full bg-stone-400'
                    : 'h-full rounded-full bg-stone-500 transition-[width] duration-200'
                }
                style={loadingPercent === null ? undefined : { width: `${loadingPercent}%` }}
              />
            </div>

            <p data-testid="twin3d-loading-bytes" className="mt-2 font-mono text-xs text-stone-500">
              {formatLoaded(progress, locale)}
            </p>
          </div>
        </div>
      )}

      {/*
        The right-hand rail. The validation panel and the village list share one column so they
        cannot overlap: both used to position themselves against the viewport, which was fine at
        four villages and is not at thirteen. The column scrolls rather than growing past the
        bottom of the map.

        The list collapses on its own control, not with the timeline. Where you are and when you
        are looking are two different questions, and folding the timeline away to see the valley
        should not also take away the way to move around it. Jumping to a village's peak still
        drives the scrubber — that is the one place the two are meant to meet.
      */}
      {/*
        ⚠️ The reading panels are hidden while a tour runs. At 1600 x 900 the right rail, the Act IV
        panel and the timeline together cover most of the canvas, which a demo recording made
        obvious: the tour talks about the valley while the valley is behind three panels. A tour
        already carries its own caption, so during one the map gets the screen.

        The drone control is NOT hidden with them. It is not a reading panel — it is the control
        that says whether the camera belongs to the viewer, and a tour is exactly when you want to
        see it hand back. `freefly.spec.ts` asserts on the toggle after a tour has started, which
        it could not do if the whole column went away.
      */}
      {ready && (
        /*
          ⚠️ Every pixel this rail spends is taken from its bottom, and its bottom is where the
          hazard legend reaches. At 1280 the legend wraps to two rows and its top rises to y≈245,
          while the Copernicus panel ended at y≈251 — a 52×6 px clip that `twin3d.spec.ts` measures,
          and that only appeared once the drone control was added above it. Hence the tight gap
          here and the tight padding in `DroneControl`: together they are the 12 px that keeps the
          two apart.

          `min-h-0` and `overflow-y-auto` make the `max-h` mean something as well, so a rail that
          gains cards in some other state scrolls rather than growing down into the same legend.
        */
        <div className="pointer-events-none absolute right-5 top-5 flex max-h-[calc(100%-5.5rem)] w-72 min-h-0 flex-col gap-2 overflow-y-auto">
          <DroneControl
            on={freeFly}
            testIdPrefix="twin3d"
            getCruiseMs={() => handleRef.current?.freeFlyCruiseMs() ?? null}
          />

          {tourStep < 0 && (
            <>
              <ValidationPanel aoiId="ahrtal-2021" />

          <BookmarkStory
            story={story}
            playingIndex={storyIndex}
            open={storyOpen}
            onToggleOpen={() => setStoryOpen((was) => !was)}
            onCapture={captureStop}
            onJump={jumpToStop}
            onRemove={removeStop}
            onPlay={() => setStoryIndex(0)}
            onStop={() => setStoryIndex(-1)}
            formatMinutes={(m) => formatClock(m, locale).slice(-5)}
          />

          {places.length > 0 && (
            <div
              data-testid="twin3d-places"
              className="pointer-events-auto flex min-h-0 flex-col rounded border border-stone-300 bg-stone-50/92 p-3 text-xs shadow-sm backdrop-blur"
            >
              <button
                type="button"
                data-testid="twin3d-places-toggle"
                aria-expanded={placesOpen}
                aria-label={placesOpen ? t('twin.collapsePlaces') : t('twin.expandPlaces')}
                onClick={() => setPlacesOpen((was) => !was)}
                className="flex w-full items-baseline justify-between gap-3 text-left"
              >
                <span className="font-semibold text-stone-800">{t('twin.places')}</span>
                <span className="text-stone-500">{placesOpen ? '−' : '+'}</span>
              </button>

              {placesOpen && (
                <>
                  {/*
                    Outside the scroll container on purpose. This is the summary the twenty rows
                    below are evidence for, and inside the list it sat under all of them — visible
                    only after scrolling to the mouth of the river, which is precisely the reader
                    least likely to need telling.
                  */}
                  {valleySpan && (
                    <p
                      data-testid="twin3d-places-span"
                      className="mt-2 leading-relaxed text-stone-700"
                    >
                      {t('twin.placesSpan', {
                        from: valleySpan.from,
                        to: valleySpan.to,
                        span: t('twin.spanHoursMinutes', {
                          hours: valleySpan.hours,
                          minutes: valleySpan.minutes,
                        }),
                      })}
                    </p>
                  )}
                  <div className="mt-2 min-h-0 overflow-y-auto">
                  <ul className="space-y-1">
                {places.map((place) => {
                  const peakMinutes = villagePeak.get(place.id);
                  const isActive = activePlace === place.id;
                  return (
                    <li
                      key={place.id}
                      className={
                        isActive
                          ? 'flex overflow-hidden rounded border border-stone-400'
                          : 'flex overflow-hidden rounded border border-stone-200'
                      }
                    >
                      <button
                        type="button"
                        data-testid={`twin3d-place-${place.id}`}
                        aria-pressed={isActive}
                        onClick={() => {
                          setActivePlace(place.id);
                          handleRef.current?.focusPlace(place.id);
                        }}
                        className={
                          isActive
                            ? 'flex-1 bg-stone-200 px-2.5 py-1 text-left text-xs text-stone-800'
                            : 'flex-1 px-2.5 py-1 text-left text-xs text-stone-600 hover:bg-stone-100 hover:text-stone-900'
                        }
                      >
                        {place.name}
                      </button>

                      {/*
                        The peak time was a label. It is the most specific question the timeline
                        can answer — "when did it reach *here*" — so it is the control that
                        answers it, and it moves the camera too: the moment is only worth seeing
                        over the village it belongs to.
                      */}
                      {peakMinutes !== undefined && (
                        <button
                          type="button"
                          data-testid={`twin3d-peak-${place.id}`}
                          aria-label={`${t('twin.jumpToPeak')} ${place.name}`}
                          onClick={() => {
                            setPlaying(false);
                            setMinutes(peakMinutes);
                            setActivePlace(place.id);
                            handleRef.current?.focusPlace(place.id);
                          }}
                          className="shrink-0 border-l border-stone-200 bg-stone-50 px-2 py-1 text-[0.65rem] tabular-nums text-stone-500 hover:bg-stone-200 hover:text-stone-900"
                        >
                          {formatClock(peakMinutes, locale).slice(-5)}
                        </button>
                      )}
                    </li>
                  );
                })}
                  </ul>
                  <p className="mt-2 leading-relaxed text-stone-500">{t('twin.placesNote')}</p>
                </div>
                </>
              )}
            </div>
          )}
            </>
          )}
        </div>
      )}

      {/*
        Act IV is hidden during a tour for the same reason as the right rail — and it costs
        nothing, because the tour's own last step is Act IV and hands over to the closing screen.
      */}
      {ready && tourStep < 0 && portfolio && handleRef.current && (
        <ActIVPanel
          portfolio={portfolio}
          flow={handleRef.current.assets.flow}
          onStageOffsetChange={(metres) => handleRef.current?.setStageOffset(metres)}
        />
      )}

      {/*
        Rendered here rather than in the shell because the six lessons carry live numbers, and
        those come from the portfolio and the flow field — both of which only exist once the scene
        has loaded. The header owns the button; this owns the screen.
      */}
      {ready && portfolio && handleRef.current && (
        <ClosingScreen portfolio={portfolio} flow={handleRef.current.assets.flow} />
      )}

      {ready && tourStep < 0 && (
        <button
          type="button"
          data-testid="tour-start"
          onClick={startTour}
          className="pointer-events-auto absolute bottom-5 left-5 z-20 rounded border border-stone-300 bg-stone-50/95 px-3 py-1.5 text-xs text-stone-700 shadow-sm backdrop-blur hover:bg-stone-200 hover:text-stone-900"
        >
          {t('tour.start')}
        </button>
      )}

      {/*
        Bottom-right is the one corner nothing else claims: Act IV holds the top-left, Copernicus
        and the village rail the right edge above it, the timeline a centred column along the
        bottom, and the tour the bottom-left.
      */}
      {ready && (
        <div className="pointer-events-none absolute bottom-5 right-5 z-20">
          <Compass handleRef={handleRef} />
        </div>
      )}

      {/*
        Gated on `ready`. Left visible during the load it showed a complete, inviting control
        panel — scrubber, play button, layer toggles, the full caveat — sitting over an empty
        canvas, every control of it dead. That reads as a broken page rather than a loading one,
        and it was covering the loading card as well. There is nothing to caption or scrub until
        the scene exists.
      */}
      {ready && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-5">
        {/*
          The tour card rides in the same centred column as the timeline panel rather than
          floating in the bottom-left corner. Floating, it cleared the panel by 12 px at 1600 px
          wide and overlapped it completely at 940, because the panel is `mx-auto max-w-3xl` and
          moves inward as the viewport narrows while a corner-anchored card does not. Sharing the
          column makes the collision impossible rather than unlikely.
        */}
        {tourStep >= 0 && (
          <TourOverlay
            story={tourStory}
            index={tourStep}
            onPickStory={pickStory}
            onNext={() => advanceTour(1)}
            onBack={() => advanceTour(-1)}
            onEnd={() => setTourStep(-1)}
          />
        )}
        {/*
          Four unexplained colours are worse than no overlay at all, so the legend appears with
          the layer. It is kept to a single compact row on purpose: the corners are taken — Act IV
          figures top left, Copernicus validation top right — and a taller version measurably
          covered both. Measured at 1280x800, where the budget is tightest: the legend's bottom is
          fixed at 275 px by the panel below it, Act IV ends at 231 and the validation panel at
          237, so anything over ~38 px tall lands on one of them. Three lines came to 66 px and
          covered Act IV by 2 552 px² and the validation panel by 1 456 px².

          So the row carries the four classes and nothing else. The title is redundant — the model
          notice below already says these are derived hazard classes and not ZÜRS — and the
          evidence sentence has moved into that notice, which is where every other layer's caveat
          is written anyway.
        */}
        {ready && showHazard && (
          <div
            data-testid="twin3d-hazard-legend"
            className="pointer-events-auto mx-auto mb-1 flex w-fit max-w-3xl flex-wrap items-baseline justify-center gap-x-4 gap-y-0.5 rounded border border-stone-300 bg-stone-50/90 px-4 py-1 text-xs shadow-sm backdrop-blur"
          >
            {(
              [
                ['GK4', '#b8211c', t('twin.hazardGk4')],
                ['GK3', '#e0691f', t('twin.hazardGk3')],
                ['GK2', '#f2b838', t('twin.hazardGk2')],
                ['GK1', '#ede3b8', t('twin.hazardGk1')],
              ] as const
            ).map(([code, swatch, label]) => (
              <span key={code} className="flex items-baseline gap-1.5 text-stone-600">
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 shrink-0 translate-y-px rounded-sm border border-stone-400"
                  style={{ backgroundColor: swatch }}
                />
                <span className="font-medium text-stone-800">{code}</span>
                <span>{label}</span>
              </span>
            ))}
          </div>
        )}

        <div className="pointer-events-auto mx-auto max-w-3xl rounded border border-stone-300 bg-stone-50/90 p-4 shadow-sm backdrop-blur">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <span data-testid="twin3d-clock" className="font-mono text-sm text-stone-900">
              {formatClock(minutes, locale)}
            </span>
            <div className="flex items-baseline gap-4">
              {timelineOpen && (
                <span data-testid="twin3d-discharge" className="text-xs text-stone-500">
                  {t('twin.discharge')}:{' '}
                  <span className="text-stone-900">
                    {new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
                      maximumFractionDigits: 0,
                    }).format(discharge)}{' '}
                    m³/s
                  </span>{' '}
                  · {new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  }).format(timesHq100(discharge))}
                  × HQ100
                </span>
              )}
              <button
                type="button"
                data-testid="twin3d-timeline-toggle"
                aria-expanded={timelineOpen}
                aria-label={timelineOpen ? t('twin.collapsePanel') : t('twin.expandPanel')}
                onClick={() => setTimelineOpen((was) => !was)}
                className="text-stone-500 hover:text-stone-900"
              >
                {timelineOpen ? '−' : '+'}
              </button>
            </div>
          </div>

          {timelineOpen && currentBeat && <StoryCaption beat={currentBeat} />}

          <div className="flex items-center gap-3">
            <button
              type="button"
              data-testid="twin3d-play"
              aria-label={playing ? t('twin.pause') : atEnd ? t('twin.replay') : t('twin.play')}
              aria-pressed={playing}
              onClick={togglePlayback}
              className="shrink-0 rounded border border-stone-300 p-1.5 text-stone-600 transition-colors hover:border-stone-400 hover:text-stone-900"
            >
              {playing ? (
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
                  <rect x="3" y="2.5" width="3.5" height="11" fill="currentColor" />
                  <rect x="9.5" y="2.5" width="3.5" height="11" fill="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M4 2.5 13 8l-9 5.5z" fill="currentColor" />
                </svg>
              )}
            </button>

            {/*
              Hidden when the panel is collapsed. Collapsed means "just the play axis", and a
              speed control is not part of the axis — the point of that mode is to get the chrome
              out of the way of the valley.
            */}
            {timelineOpen && (
              <div className="flex shrink-0 items-center gap-1.5">
                <input
                  type="range"
                  data-testid="twin3d-speed"
                  aria-label={t('twin.speedLabel')}
                  aria-valuetext={`${formatSpeed(speed, locale)}\u00d7`}
                  min={0}
                  max={PLAYBACK_SPEEDS.length - 1}
                  step={1}
                  value={speedIndex}
                  onChange={(event) => setSpeedIndex(Number(event.target.value))}
                  className="w-16 accent-stone-600"
                />
                <span
                  data-testid="twin3d-speed-value"
                  className="w-8 shrink-0 font-mono text-[0.7rem] text-stone-500"
                >
                  {formatSpeed(speed, locale)}×
                </span>
              </div>
            )}

            <div className="flex-1">
              {showStory && beats.length > 0 && (
                <StoryMarkers
                  beats={beats}
                  active={currentBeat}
                  tMin={T_MIN}
                  tMax={T_MAX}
                  onJump={(tMinutes) => {
                    setPlaying(false);
                    setMinutes(tMinutes);
                  }}
                />
              )}

              <input
                type="range"
                data-testid="twin3d-scrubber"
                aria-label={t('twin.timeline')}
                min={T_MIN}
                max={T_MAX}
                step={15}
                value={minutes}
                onChange={(event) => {
                  // Taking hold of the scrubber takes over from playback rather than fighting it.
                  setPlaying(false);
                  setMinutes(Number(event.target.value));
                }}
                className="w-full accent-stone-600"
              />
            </div>
          </div>

          <div
            data-testid="twin3d-layers"
            className={timelineOpen ? 'mt-3 flex flex-wrap items-center gap-2' : 'hidden'}
          >
            {beats.length > 0 && (
              <button
                type="button"
                data-testid="twin3d-story-toggle"
                aria-pressed={showStory}
                aria-label={showStory ? t('story.hideAnnotations') : t('story.showAnnotations')}
                onClick={() => setShowStory((was) => !was)}
                className={
                  showStory
                    ? 'ml-auto rounded bg-stone-200 px-3 py-1 text-xs text-stone-800'
                    : 'ml-auto rounded border border-stone-300 px-3 py-1 text-xs text-stone-500 hover:text-stone-800'
                }
              >
                {t('story.toggle')}
              </button>
            )}

            <button
              type="button"
              data-testid="twin3d-exaggeration-toggle"
              aria-pressed={exaggerated}
              aria-label={exaggerated ? t('twin.trueScaleOn') : t('twin.exaggerationOn')}
              onClick={() => setExaggerated((was) => !was)}
              className={
                exaggerated
                  ? 'rounded bg-stone-200 px-3 py-1 text-xs text-stone-800'
                  : 'rounded border border-stone-300 px-3 py-1 text-xs text-stone-500 hover:text-stone-800'
              }
            >
              {t('twin.exaggeration')}
            </button>

            <button
              type="button"
              data-testid="twin3d-hazard-toggle"
              aria-pressed={showHazard}
              aria-label={showHazard ? t('twin.hideHazard') : t('twin.showHazard')}
              onClick={() => setShowHazard((was) => !was)}
              className={
                showHazard
                  ? 'rounded bg-stone-200 px-3 py-1 text-xs text-stone-800'
                  : 'rounded border border-stone-300 px-3 py-1 text-xs text-stone-500 hover:text-stone-800'
              }
            >
              {t('twin.hazard')}
            </button>

            <button
              type="button"
              data-testid="twin3d-landuse-toggle"
              aria-pressed={showLanduse}
              aria-label={showLanduse ? t('twin.hideLanduse') : t('twin.showLanduse')}
              onClick={() => setShowLanduse((was) => !was)}
              className={
                showLanduse
                  ? 'rounded bg-stone-200 px-3 py-1 text-xs text-stone-800'
                  : 'rounded border border-stone-300 px-3 py-1 text-xs text-stone-500 hover:text-stone-800'
              }
            >
              {t('twin.landuse')}
            </button>

            {/* The aerial photograph. Only offered when one has been built for this AOI — a
                switch for a layer that does not exist is worse than no switch. */}
            {hasDrape && (
              <button
                type="button"
                data-testid="twin3d-drape-toggle"
                aria-pressed={showDrape}
                aria-label={showDrape ? t('twin.hideDrape') : t('twin.showDrape')}
                onClick={() =>
                  setShowDrape((was) => {
                    handleRef.current?.setDrapeVisible(!was);
                    // The photograph is what photorealistic mode is made of, so switching it off
                    // leaves the mode with nothing to render. Leave them out of step and the
                    // detail tiles keep loading for a surface nobody can see.
                    if (was) {
                      handleRef.current?.setDetailEnabled(false);
                      setPhotoreal(false);
                    }
                    return !was;
                  })
                }
                className={
                  showDrape
                    ? 'rounded bg-stone-200 px-3 py-1 text-xs text-stone-800'
                    : 'rounded border border-stone-300 px-3 py-1 text-xs text-stone-500 hover:text-stone-800'
                }
              >
                {t('twin.drape')}
              </button>
            )}

            {/* Photorealistic rendering. Offered only where the detail tiles have been built —
                switching it on without them would turn the land cover off and give nothing back. */}
            {hasDetail && (
              <button
                type="button"
                data-testid="twin3d-photoreal-toggle"
                aria-pressed={photoreal}
                aria-label={photoreal ? t('twin.hidePhotoreal') : t('twin.showPhotoreal')}
                onClick={() =>
                  setPhotoreal((was) => {
                    const on = !was;
                    handleRef.current?.setDetailEnabled(on);
                    handleRef.current?.setDrapeVisible(on);
                    setShowDrape(on);
                    // The land cover is a hand-tinted survey palette. Under a photograph it is
                    // not additional information, it is a wash over one — and the roads it draws
                    // are already in the photograph, surveyed, at 25 cm.
                    setShowLanduse(!on);
                    return on;
                  })
                }
                className={
                  photoreal
                    ? 'rounded bg-stone-800 px-3 py-1 text-xs text-stone-50'
                    : 'rounded border border-stone-300 px-3 py-1 text-xs text-stone-500 hover:text-stone-800'
                }
              >
                {t('twin.photoreal')}
              </button>
            )}

            <button
              type="button"
              data-testid="twin3d-trees-toggle"
              aria-pressed={showTrees}
              aria-label={showTrees ? t('twin.hideTrees') : t('twin.showTrees')}
              onClick={() => setShowTrees((was) => !was)}
              className={
                showTrees
                  ? 'rounded bg-stone-200 px-3 py-1 text-xs text-stone-800'
                  : 'rounded border border-stone-300 px-3 py-1 text-xs text-stone-500 hover:text-stone-800'
              }
            >
              {t('twin.trees')}
            </button>
          </div>

          {/*
            The caveat never collapses away, only shortens. PLAN §2.2 rule 3 requires that "this is
            a simulated depth, not a measurement" travels with the picture, and a picture the
            viewer has deliberately stripped down to the timeline is still the picture.
          */}
          <p data-testid="twin3d-model-notice" className="mt-3 text-[0.7rem] leading-relaxed text-stone-500">
            {timelineOpen ? (
              <>
                {t('twin.modelNotice').split('{{scale}}')[0]}
                {t(exaggerated ? 'twin.scaleExaggerated' : 'twin.scaleTrue')}
                {t('twin.modelNotice').split('{{scale}}')[1]}
                {showHazard ? ` ${t('twin.hazardNotice')}` : ''}
                {showHazard && hazardEvidence ? (
                  <span data-testid="twin3d-hazard-evidence">
                    {' '}
                    {t('twin.hazardEvidence', {
                      share: hazardEvidence.share,
                      low: hazardEvidence.low,
                      flooded: hazardEvidence.flooded,
                    })}
                  </span>
                ) : null}
                {photoreal ? ` ${t('twin.photorealNotice')}` : ''}
              </>
            ) : (
              t('twin.modelNoticeShort')
            )}
          </p>
        </div>
        </div>
      )}
    </div>
  );
}
