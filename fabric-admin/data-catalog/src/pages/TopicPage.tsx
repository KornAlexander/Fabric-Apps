import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { type CatalogTreeItem } from '@/services/catalog';
import { catalogClient } from '@/services/catalogClient';

interface FolderNode {
  folders: Map<string, FolderNode>;
  items: CatalogTreeItem[];
}

function emptyNode(): FolderNode {
  return { folders: new Map(), items: [] };
}

/** Group items into workspace → nested-folder → items. */
function buildTree(items: CatalogTreeItem[]): { workspace: string; root: FolderNode }[] {
  const byWs = new Map<string, FolderNode>();
  for (const it of items) {
    if (!byWs.has(it.workspaceName)) byWs.set(it.workspaceName, emptyNode());
    let node = byWs.get(it.workspaceName)!;
    const segments = it.folderPath ? it.folderPath.split('/').filter(Boolean) : [];
    for (const seg of segments) {
      if (!node.folders.has(seg)) node.folders.set(seg, emptyNode());
      node = node.folders.get(seg)!;
    }
    node.items.push(it);
  }
  return [...byWs.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([workspace, root]) => ({ workspace, root }));
}

function ItemRow({ item }: { item: CatalogTreeItem }) {
  const badge =
    item.itemType === 'Report'
      ? 'bg-blue-50 text-blue-700'
      : 'bg-violet-50 text-violet-700';
  return (
    <li className="flex items-center gap-2 py-1 pl-6 text-sm">
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge}`}>
        {item.itemType}
      </span>
      {item.itemType === 'Report' ? (
        <Link to={`/reports/${item.itemId}`} className="text-gray-800 hover:text-blue-700 hover:underline">
          {item.itemName}
        </Link>
      ) : (
        <span className="text-gray-800">{item.itemName}</span>
      )}
    </li>
  );
}

function FolderView({ name, node }: { name: string; node: FolderNode }) {
  const childFolders = [...node.folders.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const items = [...node.items].sort((a, b) => a.itemName.localeCompare(b.itemName));
  return (
    <details open className="pl-4">
      <summary className="cursor-pointer py-1 text-sm font-medium text-gray-600">
        📁 {name}
      </summary>
      <ul>
        {childFolders.map(([n, child]) => (
          <FolderView key={n} name={n} node={child} />
        ))}
        {items.map((it) => (
          <ItemRow key={`${it.itemType}:${it.itemId}`} item={it} />
        ))}
      </ul>
    </details>
  );
}

export function TopicPage() {
  const [items, setItems] = useState<CatalogTreeItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    catalogClient
      .listTopicItems()
      .then((r) => !cancelled && setItems(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const tree = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (items ?? []).filter(
      (i) =>
        !q ||
        `${i.workspaceName} ${i.folderPath} ${i.itemName}`.toLowerCase().includes(q)
    );
    return buildTree(rows);
  }, [items, query]);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Topics</h2>
          <p className="text-xs text-gray-500">
            Reports &amp; models by workspace and folder.
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className="w-64 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!items && !error && <p className="text-sm text-gray-500">Loading…</p>}

      <div className="space-y-3">
        {tree.map(({ workspace, root }) => (
          <div
            key={workspace}
            className="overflow-hidden rounded-xl border border-gray-100 bg-white p-3 shadow-sm"
          >
            <details open>
              <summary className="cursor-pointer text-sm font-semibold text-gray-900">
                🗂️ {workspace}
              </summary>
              <ul className="mt-1">
                {[...root.folders.entries()]
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([n, child]) => (
                    <FolderView key={n} name={n} node={child} />
                  ))}
                {[...root.items]
                  .sort((a, b) => a.itemName.localeCompare(b.itemName))
                  .map((it) => (
                    <ItemRow key={`${it.itemType}:${it.itemId}`} item={it} />
                  ))}
              </ul>
            </details>
          </div>
        ))}
        {items && tree.length === 0 && (
          <p className="text-sm text-gray-400">No items match “{query}”.</p>
        )}
      </div>
    </>
  );
}
