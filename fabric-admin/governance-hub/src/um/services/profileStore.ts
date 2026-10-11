/**
 * The stored `ui.profile` setting (plan section 5, D-11).
 *
 * Kept in the Hub's existing key/value config table, read here directly so
 * the Hub's own config service and its tests stay untouched.
 *
 * That table is writable by any signed-in user. This setting decides what is
 * shown, never what is allowed.
 */
import { getRayfinClient } from '@/services/rayfinClient';

export const UI_PROFILE_KEY = 'ui.profile';

interface ConfigRow {
  id: string;
  config_key: string;
  config_value: string;
}

/** One stored value, or `undefined` when unset or unreachable. */
export async function loadConfigValue(key: string): Promise<unknown> {
  try {
    const rows = (await getRayfinClient().data.GovConfig.findMany({
      config_key: { eq: key },
    } as never)) as unknown as ConfigRow[];
    if (rows.length === 0) return undefined;
    return JSON.parse(rows[0].config_value) as unknown;
  } catch {
    return undefined;
  }
}

/** How long the start of the app waits for the stored profile before it goes on with the default. */
export const PROFILE_WAIT_MS = 5000;

/**
 * The value, or `undefined` when it does not arrive in time. Seen live on
 * 2026-10-10: after hours without use the app once stayed on "loading". The
 * cause was not established; a slow first answer of the database is the
 * likely one, and this wait was the one place without a limit that depends
 * on it. What is shown must not wait for that.
 */
export function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      }
    );
  });
}

/** The raw stored value, or `undefined` when unset or unreachable. */
export function loadStoredProfile(): Promise<unknown> {
  return loadConfigValue(UI_PROFILE_KEY);
}

export function saveStoredProfile(profile: 'simple' | 'full', updatedBy: string): Promise<boolean> {
  return saveConfigValue(UI_PROFILE_KEY, profile, updatedBy);
}

export async function saveConfigValue(key: string, value: unknown, updatedBy: string): Promise<boolean> {
  try {
    const data = getRayfinClient().data.GovConfig;
    const rows = (await data.findMany({ config_key: { eq: key } } as never)) as unknown as ConfigRow[];
    const config_value = JSON.stringify(value);
    if (rows.length > 0) {
      await data.update({ id: rows[0].id }, { config_value, updated_by: updatedBy, updated_at: new Date() } as never);
    } else {
      await data.create({
        config_key: key,
        config_value,
        user_editable: true,
        updated_by: updatedBy,
        updated_at: new Date(),
      } as never);
    }
    return true;
  } catch {
    return false;
  }
}
