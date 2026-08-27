import { useState } from 'react';

import { runNotebook } from '@/services/udfClient';
import { isLiveCatalog } from '@/services/catalogClient';

const modelNotebookId = import.meta.env.VITE_MODEL_NOTEBOOK_ID as string | undefined;
const workspaceId = (import.meta.env.VITE_CATALOG_WORKSPACE_ID ||
  import.meta.env.VITE_FABRIC_WORKSPACE_ID) as string | undefined;

/**
 * Reframes the Direct Lake catalog model against the latest scan (fast, ~1 min)
 * via the shared fabric_proxy RunNotebook path, then reloads the current view.
 * The full nightly crawl is a scheduled job; this is the on-demand refresh.
 */
export function RefreshButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isLiveCatalog || !modelNotebookId || !workspaceId) return null;

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      await runNotebook(workspaceId, modelNotebookId);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {error && <span className="max-w-[16rem] truncate text-xs text-red-600" title={error}>{error}</span>}
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={busy}
        title="Reframe the catalog model against the latest scan"
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? 'Refreshing…' : 'Refresh data'}
      </button>
    </div>
  );
}
