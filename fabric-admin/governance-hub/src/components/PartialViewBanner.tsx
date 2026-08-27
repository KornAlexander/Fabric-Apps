import { useT } from '@/i18n';
import { getModule } from '@/modules';
import type { GapReport } from '@/domain/inventoryView';

/**
 * "This view is incomplete — on purpose" (PLAN.md §8.8).
 *
 * Every screen that can render partial data must say so, per plane, with the
 * reason. Silently truncated governance data is worse than no data: it looks
 * like an answer.
 */
export function PartialViewBanner({ gaps }: { gaps: GapReport[] }) {
  const t = useT();
  if (gaps.length === 0) return null;

  return (
    <section className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-600/20 ring-inset">
      <h3 className="text-sm font-semibold text-amber-900">{t('partial.title')}</h3>
      <p className="mt-1 text-sm text-amber-900/80">{t('partial.body')}</p>
      <ul className="mt-3 space-y-1.5">
        {gaps.map((gap) => {
          const mod = getModule(gap.module);
          return (
            <li key={gap.module} className="text-sm text-amber-900">
              <span className="font-medium">{mod ? t(mod.nameKey) : gap.module}</span>
              {': '}
              <span className="text-amber-900/80">
                {gap.reasonKey
                  ? t(gap.reasonKey, gap.reasonParams)
                  : t('partial.noCollector')}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-amber-900/70">{t('partial.upgradeHint')}</p>
    </section>
  );
}
