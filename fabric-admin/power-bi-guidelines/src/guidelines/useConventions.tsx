import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { NO_CONVENTIONS, type Conventions } from './conventions';
import { STORAGE_KEY, browserStore, readLocal, type ConventionsStore } from './store';

const StoreContext = createContext<ConventionsStore | null>(null);

/** Which store the pages use. Tests hand in their own. */
export function StoreProvider({ store, children }: { store?: ConventionsStore; children: ReactNode }) {
  const value = useMemo(() => store ?? browserStore(), [store]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): ConventionsStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>');
  return store;
}

/**
 * The team's conventions as stored in this browser. Unset and unreadable
 * both read as "nothing set": the guide then shows the standard.
 */
export function useConventions(): { conventions: Conventions; loaded: boolean; reload: () => Promise<Conventions> } {
  const store = useStore();
  const [state, setState] = useState<{ conventions: Conventions; loaded: boolean }>({ conventions: NO_CONVENTIONS, loaded: false });

  const reload = useCallback(async () => {
    const conventions = readLocal(await store.read().catch(() => undefined));
    setState({ conventions, loaded: true });
    return conventions;
  }, [store]);

  useEffect(() => {
    void reload();
    // Saved in another tab of this browser: show it here too.
    const changed = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) void reload();
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [reload]);

  return { ...state, reload };
}
