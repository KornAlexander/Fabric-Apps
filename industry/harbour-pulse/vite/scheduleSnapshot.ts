import type { Plugin } from 'vite';

import { buildScheduleSnapshot } from './gtfsSchedule';

/** Asset path (relative to the build output root) of the timetable snapshot. */
export const SCHEDULE_SNAPSHOT_FILE = 'ferries/schedule.json';

/**
 * Emits a static TfNSW GTFS timetable snapshot into the production bundle.
 *
 * The deployed app is static content hosted by Fabric — there is no server to
 * hold the `TFNSW_API_KEY`, so the timetable is baked in at build time and the
 * browser picks today's service date out of it (see `fetchFerrySchedule`).
 *
 * If the key is missing the build still succeeds; the Timetable panel simply
 * reports that no snapshot was published.
 *
 * @param days Number of consecutive service days to bake in, starting today.
 */
export function scheduleSnapshotPlugin(days = 14): Plugin {
  let root = process.cwd();
  return {
    name: 'ferry-schedule-snapshot',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    async generateBundle() {
      try {
        const snapshot = await buildScheduleSnapshot(root, days);
        const dates = Object.keys(snapshot.byDate);
        const total = dates.reduce((n, d) => n + snapshot.byDate[d].length, 0);
        this.emitFile({
          type: 'asset',
          fileName: SCHEDULE_SNAPSHOT_FILE,
          source: JSON.stringify(snapshot),
        });
        this.info(
          `timetable snapshot: ${total} departures across ${dates.length} days ` +
            `(${dates[0]} → ${dates[dates.length - 1]})`,
        );
      } catch (err) {
        this.warn(
          `timetable snapshot skipped — the Timetable panel will be empty. ${(err as Error).message}`,
        );
      }
    },
  };
}
