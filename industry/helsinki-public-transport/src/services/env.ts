/**
 * Reads a build-time variable that has no safe default.
 *
 * The published template ships no fallback ids, so a missing value is a configuration error.
 * Failing here names the variable, instead of a later opaque MSAL or Power BI error.
 */
export function requireEnv(name: string): string {
  const value: unknown = (import.meta.env as Record<string, unknown>)[name];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}
