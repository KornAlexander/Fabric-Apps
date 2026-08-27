import { useAnalysis } from '@/hooks/useAnalysis';
import { useT, type TranslationKey } from '@/i18n';

const LEVER_LABEL: Record<string, TranslationKey> = {
  'dlp-default-blocked': 'posture.lever.dlpDefaultBlocked',
  'dlp-custom-connector-urls': 'posture.lever.dlpCustomConnectorUrls',
  'tenant-isolation': 'posture.lever.tenantIsolation',
  'disable-share-with-everyone': 'posture.lever.disableShareWithEveryone',
  'restrict-environment-creation': 'posture.lever.restrictEnvironmentCreation',
  'exchange-transport-rule': 'posture.lever.exchangeTransportRule',
};

const STATUS_STYLE = {
  pass: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  fail: 'bg-rose-50 text-rose-800 ring-rose-600/20',
  unknown: 'bg-gray-100 text-gray-600 ring-gray-500/20',
} as const;

/**
 * Default-environment posture (PLAN.md §8.6).
 *
 * The Default environment is the one place membership cannot be controlled: a
 * security group cannot be bound to it, and `Basic User` + `Environment Maker`
 * are auto-assigned in a way that survives the opt-out. There is no supported
 * way to close that. So this page scores the six **containment** levers that do
 * work — all of them licence-free — with deliberately simple arithmetic an
 * admin can reproduce by hand.
 */
export function DefaultPosturePage() {
  const t = useT();
  const { state, posture } = useAnalysis();

  const known = posture.levers.filter((l) => l.status !== 'unknown').length;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-xl font-semibold text-gray-900">{t('posture.title')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('posture.intro')}</p>
      </section>

      <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
        {t('pp.defaultHole.body')}
      </p>

      {state === 'loading' ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : (
        <>
          <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-xs tracking-wide text-gray-500 uppercase">
                  {t('posture.score')}
                </p>
                <p className="mt-1 text-3xl font-semibold text-gray-900">
                  {posture.passed} / {posture.total}
                </p>
              </div>
              <p className="text-sm text-gray-600">
                {posture.environmentName
                  ? t('posture.environment', { name: posture.environmentName })
                  : t('posture.noEnvironment')}
              </p>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {t('posture.scoreExplain', {
                known: String(known),
                total: String(posture.total),
              })}
            </p>
          </section>

          <section className="space-y-2">
            {posture.levers.map((lever) => (
              <div
                key={lever.id}
                className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${STATUS_STYLE[lever.status]}`}
                  >
                    {t(`posture.status.${lever.status}`)}
                  </span>
                  <span className="font-medium text-gray-900">
                    {t(LEVER_LABEL[lever.id] ?? 'common.error')}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-600">{lever.detail}</p>
              </div>
            ))}
          </section>

          <p className="text-xs text-gray-500">{t('posture.unknownNote')}</p>
        </>
      )}
    </div>
  );
}

export default DefaultPosturePage;
