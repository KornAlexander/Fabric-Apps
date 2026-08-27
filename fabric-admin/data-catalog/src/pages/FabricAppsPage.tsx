import { useMemo, useState } from 'react';

import {
  FABRIC_APPS,
  fromCustomerProject,
  wasPresented,
  type AppTier,
  type FabricApp,
} from '@/config/fabricApps';

const TIER_ORDER: AppTier[] = ['A', 'B', 'C', 'D', 'E'];

type PresentationFilter = 'all' | 'presented' | 'customer';

function initials(name: string): string {
  return name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function AppCard({ app }: { app: FabricApp }) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md">
      <a
        href={app.url}
        target="_blank"
        rel="noreferrer"
        className={`relative block aspect-video overflow-hidden bg-gradient-to-br ${app.accent}`}
      >
        {app.screenshot ? (
          <img
            src={app.screenshot}
            alt={`${app.name} preview`}
            loading="lazy"
            className="h-full w-full object-cover object-top transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-4xl font-bold tracking-tight text-white/90 drop-shadow-sm">
              {initials(app.name)}
            </span>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-md bg-black/40 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          Tier {app.tier}
        </span>
        {app.status === 'wip' && (
          <span className="absolute right-2 top-2 rounded-md bg-amber-400/90 px-2 py-0.5 text-[11px] font-semibold text-amber-950">
            In progress
          </span>
        )}
      </a>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-snug text-gray-900">{app.name}</h3>
        </div>
        <p className="text-xs leading-relaxed text-gray-600">{app.tagline}</p>

        <dl className="mt-1 space-y-0.5 text-[11px] text-gray-500">
          <div className="flex gap-1">
            <dt className="font-medium text-gray-400">Tech</dt>
            <dd className="truncate">{app.tech}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium text-gray-400">Data</dt>
            <dd className="truncate">{app.dataPattern}</dd>
          </div>
        </dl>

        <div className="mt-1 flex flex-wrap gap-1.5">
          {wasPresented(app) &&
            app.presentations.map((p) => (
              <span
                key={p.event}
                title={p.event}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  p.status === 'presented'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-blue-100 text-blue-800'
                }`}
              >
                {p.status === 'presented' ? '✓ Presented' : '◷ Planned'}
                {p.date ? ` · ${p.date}` : ''}
              </span>
            ))}
          {fromCustomerProject(app) && (
            <span
              title={app.customerProject}
              className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-800"
            >
              ★ Customer project: {app.customerProject}
            </span>
          )}
          {app.isCustomerNamed && (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-800">
              Customer-named
            </span>
          )}
        </div>

        <div className="mt-auto pt-2">
          <a
            href={app.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
          >
            Open app ↗
          </a>
        </div>
      </div>
    </div>
  );
}

export function FabricAppsPage() {
  const [query, setQuery] = useState('');
  const [showCustomerNamed, setShowCustomerNamed] = useState(false);
  const [tier, setTier] = useState<AppTier | 'all'>('all');
  const [presentation, setPresentation] = useState<PresentationFilter>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FABRIC_APPS.filter((app) => {
      if (!showCustomerNamed && app.isCustomerNamed) return false;
      if (tier !== 'all' && app.tier !== tier) return false;
      if (presentation === 'presented' && !wasPresented(app)) return false;
      if (presentation === 'customer' && !fromCustomerProject(app)) return false;
      if (q) {
        const hay = [app.name, app.tagline, app.tech, app.dataPattern, app.proves, app.customerProject]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [query, showCustomerNamed, tier, presentation]);

  const grouped = useMemo(() => {
    return TIER_ORDER.map((t) => ({
      tier: t,
      apps: filtered.filter((a) => a.tier === t),
    })).filter((g) => g.apps.length > 0);
  }, [filtered]);

  const hiddenCustomer = FABRIC_APPS.filter((a) => a.isCustomerNamed).length;

  return (
    <>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">Fabric Apps</h2>
        <p className="text-xs text-gray-500">
          {filtered.length} of {FABRIC_APPS.length} apps · data-driven apps built on the
          Fabric lakehouse & semantic models with Rayfin
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter apps, tech, data pattern…"
          className="w-64 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
        />

        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as AppTier | 'all')}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400"
        >
          <option value="all">All tiers</option>
          {TIER_ORDER.map((t) => (
            <option key={t} value={t}>
              Tier {t}
            </option>
          ))}
        </select>

        <select
          value={presentation}
          onChange={(e) => setPresentation(e.target.value as PresentationFilter)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400"
        >
          <option value="all">All apps</option>
          <option value="presented">Presented only</option>
          <option value="customer">From a customer project</option>
        </select>

        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={showCustomerNamed}
            onChange={(e) => setShowCustomerNamed(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Show customer-named apps
          {!showCustomerNamed && hiddenCustomer > 0 && (
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
              {hiddenCustomer} hidden
            </span>
          )}
        </label>
      </div>

      {grouped.length === 0 ? (
        <div className="rounded-lg border border-gray-100 bg-white px-4 py-12 text-center text-sm text-gray-400">
          No apps match the current filters.
        </div>
      ) : (
        grouped.map((g) => (
          <section key={g.tier} className="mb-8">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Tier {g.tier}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.apps.map((app) => (
                <AppCard key={app.id} app={app} />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
