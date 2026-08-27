import { useState } from 'react';

import { ChecklistPanel } from '@/components/ChecklistPanel';
import { FleetPanel } from '@/components/FleetPanel';
import { SchedulePanel } from '@/components/SchedulePanel';

interface SidePanelProps {
  /** Fly the camera to the given position when a fleet row is clicked. */
  onSelectFerry: (lon: number, lat: number) => void;
}

type Tab = 'fleet' | 'timetable' | 'checklist';

/**
 * A single hamburger-controlled drawer that hosts both the live Fleet list and
 * the GTFS Timetable behind a tab switch. The hamburger button sits above the
 * menu and toggles it open/closed. Both panels stay mounted so their live polls
 * keep running while hidden.
 */
export function SidePanel({ onSelectFerry }: SidePanelProps) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>('fleet');

  return (
    <>
      {/* Hamburger — sits above the menu */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Collapse menu' : 'Open menu'}
        aria-expanded={open}
        className="absolute left-3 top-3 z-40 grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-slate-950/85 text-white shadow-xl backdrop-blur-xl transition-colors hover:bg-slate-900/90"
      >
        <span className="relative flex h-4 w-5 flex-col justify-between">
          <span
            className={`h-0.5 w-full rounded-full bg-current transition-transform duration-300 ${
              open ? 'translate-y-[7px] rotate-45' : ''
            }`}
          />
          <span
            className={`h-0.5 w-full rounded-full bg-current transition-opacity duration-200 ${
              open ? 'opacity-0' : 'opacity-100'
            }`}
          />
          <span
            className={`h-0.5 w-full rounded-full bg-current transition-transform duration-300 ${
              open ? '-translate-y-[7px] -rotate-45' : ''
            }`}
          />
        </span>
      </button>

      {/* Combined menu drawer */}
      <div
        className={`absolute left-3 top-16 bottom-3 z-30 flex w-[340px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 shadow-2xl backdrop-blur-xl transition-all duration-300 ${
          open ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-[115%] opacity-0'
        }`}
      >
        {/* Tab switcher */}
        <div className="m-3 grid grid-cols-3 gap-1 rounded-lg bg-white/[0.06] p-1 text-[12px] font-medium">
          <button
            onClick={() => setTab('fleet')}
            className={`rounded-md py-1.5 transition-colors ${
              tab === 'fleet' ? 'bg-[#00843D] text-white' : 'text-white/55 hover:text-white'
            }`}
          >
            ⚓ Fleet
          </button>
          <button
            onClick={() => setTab('timetable')}
            className={`rounded-md py-1.5 transition-colors ${
              tab === 'timetable' ? 'bg-[#00843D] text-white' : 'text-white/55 hover:text-white'
            }`}
          >
            🕑 Timetable
          </button>
          <button
            onClick={() => setTab('checklist')}
            className={`rounded-md py-1.5 transition-colors ${
              tab === 'checklist' ? 'bg-[#00843D] text-white' : 'text-white/55 hover:text-white'
            }`}
          >
            ✓ Checks
          </button>
        </div>

        {/* Active panel body — both stay mounted so live polls keep running */}
        <div className={`min-h-0 flex-1 ${tab === 'fleet' ? 'flex' : 'hidden'}`}>
          <FleetPanel onSelect={(f) => onSelectFerry(f.lon, f.lat)} />
        </div>
        <div className={`min-h-0 flex-1 ${tab === 'timetable' ? 'flex' : 'hidden'}`}>
          <SchedulePanel />
        </div>
        <div className={`min-h-0 flex-1 ${tab === 'checklist' ? 'flex' : 'hidden'}`}>
          <ChecklistPanel />
        </div>
      </div>
    </>
  );
}
