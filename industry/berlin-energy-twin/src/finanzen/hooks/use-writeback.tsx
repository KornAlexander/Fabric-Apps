// Writeback in the Caldova Finanzen tab: OFF (Alexander 2026-10-20: "writeback later if ever").
//
// The ported pages still read `useWriteback()` (GuvPage reads `effective` adjustments), so the hook keeps
// its shape and always answers the cockpit's own "off" value. No store, no Rayfin client, no app
// database tables: the tab writes nothing (PLAN-FINANZEN.md §4.4).

import { createContext, useContext, type ReactNode } from 'react';

import type { AdjustmentLike } from '@finanzen/lib/pnl/adjust';

/** A forecast adjustment as the GuV engine applies it (none while writeback is off). */
export type ForecastAdjustmentRecord = AdjustmentLike;

export interface WritebackValue {
  status: 'off';
  effective: Map<string, ForecastAdjustmentRecord>;
}

const EMPTY: WritebackValue = { status: 'off', effective: new Map() };

const WritebackContext = createContext<WritebackValue>(EMPTY);
export const useWriteback = () => useContext(WritebackContext);

/** Kept so a copied provider wrapper compiles; it only ever serves the "off" value. */
export function WritebackProvider({ children }: { children: ReactNode }) {
  return <WritebackContext.Provider value={EMPTY}>{children}</WritebackContext.Provider>;
}
