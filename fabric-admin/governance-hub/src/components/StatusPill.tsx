import type { ModuleStatus } from '@/modules/types';
import { useT } from '@/i18n';

const STYLES: Record<ModuleStatus, string> = {
  available: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  degraded: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  unavailable: 'bg-rose-50 text-rose-800 ring-rose-600/20',
  disabled: 'bg-gray-100 text-gray-600 ring-gray-500/20',
  checking: 'bg-blue-50 text-blue-800 ring-blue-600/20',
};

const LABEL_KEYS = {
  available: 'module.status.available',
  degraded: 'module.status.degraded',
  unavailable: 'module.status.unavailable',
  disabled: 'module.status.disabled',
  checking: 'module.status.checking',
} as const;

/** Status pill. Deliberately colour + text, never colour alone (a11y). */
export function StatusPill({ status }: { status: ModuleStatus }) {
  const t = useT();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}
    >
      {t(LABEL_KEYS[status])}
    </span>
  );
}
