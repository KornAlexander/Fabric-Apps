import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Whether the closing screen is open.
 *
 * It lives in a context because the two halves are in different places: PLAN §9.0 wants the
 * screen reachable "always available from the header", but the lessons it shows are computed from
 * the portfolio and the flow field, which only exist inside the 3D view. Rather than lift the
 * whole data layer into the shell, the shell owns a boolean and the view owns the screen.
 */
interface ClosingValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const ClosingContext = createContext<ClosingValue | null>(null);

export function ClosingProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo<ClosingValue>(() => ({ open, setOpen }), [open]);
  return <ClosingContext.Provider value={value}>{children}</ClosingContext.Provider>;
}

export function useClosing(): ClosingValue {
  const ctx = useContext(ClosingContext);
  if (!ctx) throw new Error('useClosing must be used inside <ClosingProvider>');
  return ctx;
}
