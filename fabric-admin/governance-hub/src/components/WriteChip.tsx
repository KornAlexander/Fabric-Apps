import { writeChipState } from '@/domain/writeGates';
import { useGovernance } from '@/hooks/GovernanceContext';
import { useT } from '@/i18n';

/**
 * Permanent header chip (PLAN.md §8.7).
 *
 * Nobody should ever have to guess whether this tool is currently able to
 * change their tenant.
 */
export function WriteChip() {
  const t = useT();
  const { writeConfig } = useGovernance();
  const state = writeChipState(writeConfig);

  if (!state.armed) {
    return (
      <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-1 font-mono text-xs font-semibold text-gray-600 ring-1 ring-inset ring-gray-500/20">
        {t('writes.chip.off')}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-1 font-mono text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-600/30">
      {t('writes.chip.armed', {
        kinds: state.kinds,
        scopes: state.scopes === Infinity ? '∞' : state.scopes,
      })}
    </span>
  );
}
