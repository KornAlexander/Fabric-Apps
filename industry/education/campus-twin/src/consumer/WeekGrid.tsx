/**
 * One person's teaching week as a grid. Read-only, and structurally incapable of being otherwise.
 *
 * ⚠️ NOT `CalendarPanel.tsx`. That component is 119 KB and imports `AvailabilityPanel`,
 * `planner/moveCheck` and the AOI config, because it exists to let a planner drag a session into a
 * different slot and be told why that is illegal. Reusing it here would ship the whole editing
 * apparatus to a reader who is not allowed to edit, and would drag two files another task is
 * currently holding into this build. A consumer grid renders and stops.
 */

import { useMemo } from 'react';

import type { Slot, Week, WeekEntry } from './api';

const DAY_LABEL: Record<string, string> = {
  Mo: 'Montag',
  Di: 'Dienstag',
  Mi: 'Mittwoch',
  Do: 'Donnerstag',
  Fr: 'Freitag',
  Sa: 'Samstag',
  So: 'Sonntag',
};

export function WeekGrid({ week }: { week: Week }): React.ReactElement {
  // ⚠️ THE SLOT LIST IS THE SITE'S OWN, NEVER A HARD-CODED Mo..Fr. `oth-real` teaches on Saturday
  // and TUM runs eleven back-to-back hourly blocks against OTH's six 90-minute ones. A grid that
  // assumed five days and six blocks would silently drop a Saturday lecture, which is precisely
  // the kind of omission a reader cannot detect.
  const slots: Slot[] = week.slots ?? week.grid ?? [];

  const { days, blocks, byCell } = useMemo(() => {
    const dayOrder = new Map<string, number>();
    for (const s of slots) if (!dayOrder.has(s.day)) dayOrder.set(s.day, s.dayIndex);
    const days = [...dayOrder.entries()].sort((a, b) => a[1] - b[1]).map(([d]) => d);

    const blockMap = new Map<number, Slot>();
    for (const s of slots) if (!blockMap.has(s.block)) blockMap.set(s.block, s);
    const blocks = [...blockMap.entries()].sort((a, b) => a[0] - b[0]);

    const byCell = new Map<string, WeekEntry[]>();
    for (const e of week.entries) {
      const list = byCell.get(e.slotId) ?? [];
      list.push(e);
      byCell.set(e.slotId, list);
    }
    return { days, blocks, byCell };
  }, [slots, week.entries]);

  const slotIdFor = (day: string, block: number): string | null =>
    slots.find((s) => s.day === day && s.block === block)?.slotId ?? null;

  if (!slots.length) {
    return (
      <p className="p-4 text-sm opacity-70">
        Für diesen Standort liegt kein Stundenraster vor.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-[var(--surface,#fff)] p-2 text-left font-medium opacity-70">
              Zeit
            </th>
            {days.map((day) => (
              <th key={day} className="p-2 text-left font-medium">
                <span className="hidden sm:inline">{DAY_LABEL[day] ?? day}</span>
                <span className="sm:hidden">{day}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blocks.map(([block, sample]) => (
            <tr key={block} className="border-t border-black/10">
              <th
                scope="row"
                className="sticky left-0 z-10 whitespace-nowrap bg-[var(--surface,#fff)] p-2 text-left font-normal tabular-nums opacity-70"
              >
                {sample.startTime}
                <span className="hidden sm:inline">–{sample.endTime}</span>
              </th>
              {days.map((day) => {
                const slotId = slotIdFor(day, block);
                const entries = slotId ? byCell.get(slotId) ?? [] : [];
                return (
                  <td key={day} className="align-top p-1">
                    {entries.map((e) => (
                      <article
                        key={e.sessionId}
                        className="mb-1 rounded-md bg-[color-mix(in_srgb,currentColor_8%,transparent)] p-2"
                      >
                        <div className="font-medium leading-tight">{e.course ?? e.sessionId}</div>
                        <div className="mt-0.5 text-xs opacity-70">
                          {/* Room and building are what a person standing in a corridor needs. */}
                          {[e.roomId, e.buildingId ? `Geb. ${e.buildingId}` : null, e.cohort]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </article>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
