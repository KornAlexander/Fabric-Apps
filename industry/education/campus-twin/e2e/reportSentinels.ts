/**
 * Made-up ids for the report window tests: what the dev server is started with
 * (`playwright.config.ts`) and what `building-report.spec.ts` then expects in the frame's address.
 *
 * Built from parts, so no file here holds a whole id that could be mistaken for a tenant's or a
 * report's. They only have to be well-formed and different from each other.
 */
const sentinel = (digit: string): string => [8, 4, 4, 4, 12].map((n) => digit.repeat(n)).join('-');

export const TENANT = sentinel('a');
export const REPORT = sentinel('1');
export const DEMO_REPORT = sentinel('9');
export const DEMO_REPORT_EN = sentinel('7');