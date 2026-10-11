/**
 * Which shell the app shows (plan section 5, D-11).
 *
 * Two levels. The build decides which advanced Hub areas exist at all; the
 * stored setting chooses among what the build contains. The stored setting
 * lives in a table any signed-in user can write, so it keeps things tidy and
 * protects nothing.
 */
export type UiProfile = 'simple' | 'full';

export interface ProfileInputs {
  /** `false` when the build was made without the advanced Hub areas. */
  advancedInBuild: boolean;
  /** Raw stored value of `ui.profile`. Only `'full'` and `'simple'` count as set. */
  storedProfile: unknown;
  /** What the build shows while nothing is stored. Three tabs unless the build says otherwise. */
  defaultProfile?: UiProfile;
}

/**
 * Three tabs unless the build contains the Hub *and* either the stored
 * setting or, while nothing is stored, the build default asks for it.
 */
export function resolveProfile({ advancedInBuild, storedProfile, defaultProfile = 'simple' }: ProfileInputs): UiProfile {
  if (!advancedInBuild) return 'simple';
  if (storedProfile === 'full' || storedProfile === 'simple') return storedProfile;
  return defaultProfile;
}

export const UM_PATHS = {
  root: '/um',
  workspaces: '/um/workspaces',
  audiences: '/um/audiences',
  modelRoles: '/um/model-roles',
  setup: '/um/setup',
  person: '/um/person',
} as const;
