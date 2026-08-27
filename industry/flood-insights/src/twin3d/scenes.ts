/**
 * The scenes this app can show, and which of them are ready.
 *
 * Modelled on the airport switch in Airport IQ: a manifest, a `<select>` populated from it, and
 * **one function that both boots and switches**. That app's approach view has no separate
 * bootstrap path — `focusAirport()` runs on first load and on every change — and that is why its
 * switch is reliable. The same rule applies here: `SceneSwitch` sets the id, and the id is the
 * only thing that decides what renders.
 *
 * ⚠️ `ready: false` entries are listed and disabled rather than hidden, so unfinished work looks
 * unfinished instead of looking like it was never intended. Horta Sud and Castel Bolognese were
 * blocked that way until 2026-08-02; they now have terrain, a flow field, a Manning rating, land
 * cover and an aerial drape, and render as `reach` — a steady discharge rather than a timeline,
 * because neither event's gauge series is publicly retrievable.
 */

export type SceneKind = 'valley' | 'corridor' | 'reach';

export interface SceneEntry {
  /** Matches the AOI config id and the public/terrain/<id> folder. */
  id: string;
  /** Short label for the dropdown. */
  labelKey: string;
  /**
   * `valley` renders the full hydraulic twin (chainage, rating curve, connectivity mask).
   * `corridor` renders the Steinbach scene, which has no hydraulics — see src/data/steinbach.ts.
   * `reach` renders a river at a chosen STEADY discharge, with no clock at all, because neither
   * of those AOIs has a retrievable gauge record — see src/components/ReachScene.tsx.
   */
  kind: SceneKind;
  ready: boolean;
  /** Why it cannot be selected yet. Shown to the user, not just left as a disabled option. */
  blockedKey?: string;
}

export const SCENES: SceneEntry[] = [
  { id: 'ahrtal-2021', labelKey: 'scenes.ahrtal', kind: 'valley', ready: true },
  { id: 'steinbach-2021', labelKey: 'scenes.steinbach', kind: 'corridor', ready: true },
  {
    id: 'hortasud-2024',
    labelKey: 'scenes.hortasud',
    kind: 'reach',
    ready: true,
  },
  {
    id: 'castelbolognese-2023',
    labelKey: 'scenes.castelbolognese',
    kind: 'reach',
    ready: true,
  },
];

export const DEFAULT_SCENE_ID = 'ahrtal-2021';

export function findScene(id: string | null | undefined): SceneEntry {
  const hit = SCENES.find((s) => s.id === id && s.ready);
  return hit ?? SCENES.find((s) => s.id === DEFAULT_SCENE_ID)!;
}

/**
 * Resolve the scene to open, in the same precedence Airport IQ uses: URL first so a link is
 * shareable, then the last choice, then the default. A stale or not-ready id falls back rather
 * than rendering an empty map.
 */
export function resolveInitialScene(
  search: string,
  stored: string | null | undefined
): SceneEntry {
  const requested = new URLSearchParams(search).get('scene');
  const fromUrl = SCENES.find((s) => s.id === requested && s.ready);
  if (fromUrl) return fromUrl;
  return findScene(stored);
}
