import { useState } from 'react';

import { useT, type TranslationKey } from '@/i18n';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export interface PreflightCheck {
  id: string;
  titleKey: TranslationKey;
  status: CheckStatus;
  /** Shown when the check is not passing. */
  fixKey?: TranslationKey;
  /** Copy-pasteable command that resolves the check. Never localised. */
  command?: string;
  /** Raw technical detail — API error text, ids. Never localised. */
  detail?: string;
  /** True when no automation can resolve this; a human admin must act. */
  needsHuman?: boolean;
}

const DOT: Record<CheckStatus, string> = {
  pass: 'bg-emerald-500',
  warn: 'bg-amber-500',
  fail: 'bg-rose-500',
  unknown: 'bg-gray-400',
};

const STATUS_KEY: Record<CheckStatus, TranslationKey> = {
  pass: 'check.status.pass',
  warn: 'check.status.warn',
  fail: 'check.status.fail',
  unknown: 'check.status.unknown',
};

function CopyButton({ value }: { value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
    >
      {copied ? t('common.copied') : t('common.copy')}
    </button>
  );
}

/**
 * One row of the Setup pre-flight (PLAN.md §8.4).
 *
 * The Setup page is also the honest-onboarding artifact for a customer security
 * review, so every failing check must say what breaks and how to fix it — with
 * the exact command where one exists.
 */
export function CheckRow({ check }: { check: PreflightCheck }) {
  const t = useT();
  return (
    <li className="flex gap-3 border-b border-gray-100 py-3 last:border-0">
      <span
        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[check.status]}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium text-gray-900">{t(check.titleKey)}</span>
          <span className="text-xs text-gray-500">{t(STATUS_KEY[check.status])}</span>
          {check.needsHuman && (
            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-800 ring-1 ring-inset ring-violet-600/20">
              {t('setup.humanStep')}
            </span>
          )}
        </div>
        {check.status !== 'pass' && check.fixKey && (
          <p className="mt-1 text-sm text-gray-600">{t(check.fixKey)}</p>
        )}
        {check.command && (
          <div className="mt-2 flex items-start gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-100">
              {check.command}
            </code>
            <CopyButton value={check.command} />
          </div>
        )}
        {check.detail && (
          <p className="mt-1 truncate font-mono text-xs text-gray-400" title={check.detail}>
            {check.detail}
          </p>
        )}
      </div>
    </li>
  );
}
