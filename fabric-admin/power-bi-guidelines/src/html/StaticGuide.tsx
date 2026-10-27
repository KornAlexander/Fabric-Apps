/**
 * The guide as a plain page: no script, no questionnaire, no search. Built
 * into one HTML file per language (`npm run build:html`), from the same
 * content and drawings as the app.
 */
import { MeterList } from '@/guidelines/charts';
import { rulesIn, sectionsFor } from '@/guidelines/guide';
import type { Locale, Translate } from '@/i18n';

import { GuideBody, anchor, topicAnchor } from '@/components/GuideBody';

export function StaticGuide({ locale, t, version }: { locale: Locale; t: Translate; version: string }) {
  const guide = sectionsFor(locale);
  const totals = { areas: guide.length, topics: guide.reduce((n, s) => n + s.subs.length, 0), rules: guide.reduce((n, s) => n + rulesIn(s), 0) };
  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
        <header className="guide-hero overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700 p-6 text-white shadow-sm sm:p-8">
          <div className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_22rem]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-white/80">{t('gl.kicker')}</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t('gl.title')}</h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/90">{t('gl.tagline')}</p>
              <dl className="mt-6 grid max-w-md grid-cols-3 gap-3">
                {(['areas', 'topics', 'rules'] as const).map((key) => (
                  <div key={key} className="flex flex-col-reverse rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/20">
                    <dt className="text-xs text-white/80">{t(`gl.stat.${key}`)}</dt>
                    <dd className="text-2xl font-semibold tabular-nums">{totals[key]}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rounded-xl bg-white/10 p-4 ring-1 ring-white/20">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/80">{t('gl.rulesPerArea')}</p>
              <MeterList onDark rows={guide.map((s) => ({ name: `${s.num} ${s.title}`, value: rulesIn(s), text: String(rulesIn(s)) }))} />
            </div>
          </div>
        </header>

        <p className="max-w-3xl text-sm leading-relaxed text-slate-600">{t('html.note')}</p>

        <nav aria-labelledby="guide-contents" className="guide-contents rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
          <h2 id="guide-contents" className="text-base font-semibold text-slate-900">
            {t('html.contents')}
          </h2>
          <ol className="mt-3 grid gap-4 sm:grid-cols-3">
            {guide.map((section) => (
              <li key={section.id}>
                <a href={`#${anchor(section.id)}`} className="text-sm font-semibold text-blue-700 underline-offset-2 hover:underline">
                  {`${section.num} ${section.title}`}
                </a>
                <ol className="mt-1.5 space-y-1">
                  {section.subs.map((sub) => (
                    <li key={sub.num}>
                      <a href={`#${topicAnchor(sub.num)}`} className="text-sm text-slate-700 underline-offset-2 hover:underline">
                        <span className="mr-1.5 font-mono text-xs text-slate-500">{sub.num}</span>
                        {sub.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </nav>

        <GuideBody sections={guide} answers={{}} t={t} locale={locale} outline="document" />

        <footer className="border-t border-slate-200 pt-6">
          <p className="text-base font-medium text-slate-800">{t('gl.closing')}</p>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">{t('gl.sources')}</p>
          <p className="mt-3 text-xs text-slate-500">{t('html.made', { version })}</p>
        </footer>
      </main>
    </div>
  );
}
