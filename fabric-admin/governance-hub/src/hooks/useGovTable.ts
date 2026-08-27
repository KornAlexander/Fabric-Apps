/**
 * Hook for reading one governance table (PLAN.md §13).
 *
 * Encapsulates the three states every module page must handle honestly:
 *   `no-model`  — the semantic model is not provisioned yet
 *   `empty`     — the model exists but this plane's collector has not run
 *   `ready`     — rows
 *
 * The distinction matters: "nothing here" and "we cannot see" look identical in
 * a table and mean completely different things to someone deciding whether their
 * tenant is governed.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getGovEnv } from '@/config/govEnv';
import type { GovTableName } from '@/domain/govSchema';
import { getModelTarget, queryTable, type QueryOptions } from '@/services/govModel';

export type GovTableState = 'loading' | 'no-model' | 'empty' | 'ready' | 'error';

export interface UseGovTableResult {
  state: GovTableState;
  rows: Record<string, string>[];
  error?: string;
  reload: () => void;
}

export function useGovTable(
  table: GovTableName,
  options: QueryOptions = {}
): UseGovTableResult {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [state, setState] = useState<GovTableState>('loading');
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);

  const target = useMemo(() => getModelTarget(getGovEnv()), []);
  // Options are usually an inline literal; serialising keeps the effect stable
  // instead of re-querying on every render.
  const optionsKey = JSON.stringify(options);

  useEffect(() => {
    if (!target) {
      setState('no-model');
      return;
    }
    let cancelled = false;
    setState('loading');
    setError(undefined);

    queryTable(target, table, JSON.parse(optionsKey) as QueryOptions)
      .then((result) => {
        if (cancelled) return;
        setRows(result);
        setState(result.length === 0 ? 'empty' : 'ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRows([]);
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [target, table, optionsKey, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, rows, error, reload };
}
