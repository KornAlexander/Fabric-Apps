import { useT, type TranslationKey } from '@/i18n';
import type { ReachTier } from '@/modules/types';

const STYLES: Record<ReachTier, string> = {
  T0: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  T1: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  T2: 'bg-amber-50 text-amber-900 ring-amber-600/30',
};

const EXPLAIN: Record<ReachTier, TranslationKey> = {
  T0: 'tier.T0.explain',
  T1: 'tier.T1.explain',
  T2: 'tier.T2.explain',
};

/**
 * Reach-tier badge (PLAN.md §8.8).
 *
 * Permanently visible next to the write chip, because "how much of the tenant
 * am I actually seeing" is exactly as important as "can this thing write".
 */
export function TierBadge({ tier }: { tier: ReachTier }) {
  const t = useT();
  return (
    <span
      title={t(EXPLAIN[tier])}
      aria-label={t('tier.badge.aria')}
      className={`inline-flex items-center rounded-md px-2 py-1 font-mono text-xs font-semibold ring-1 ring-inset ${STYLES[tier]}`}
    >
      {t(`module.tier.${tier}`)}
    </span>
  );
}
