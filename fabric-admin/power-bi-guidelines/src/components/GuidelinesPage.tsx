import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { useI18n } from '@/i18n';
import { answeredGroups, progressOf } from '@/guidelines/conventions';
import { MeterList, ProgressRing } from '@/guidelines/charts';
import { rulesIn, searchGuide, sectionsFor } from '@/guidelines/guide';
import { useConventions } from '@/guidelines/useConventions';
import { PATHS } from '@/paths';

import { GuideBody, anchor } from './GuideBody';

function jumpTo(id: string) {
  document.getElementById(anchor(id))?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

/** The guide: the Power BI guidelines, with the team's own conventions filled in. */
export function GuidelinesPage() {
  const { t, locale } = useI18n();
  const { conventions, loaded } = useConventions();
  const answers = conventions.answers;
  const [query, setQuery] = useState('');

  const guide = sectionsFor(locale);
  const totals = useMemo(() => ({ areas: guide.length, topics: guide.reduce((n, s) => n + s.subs.length, 0), rules: guide.reduce((n, s) => n + rulesIn(s), 0) }), [guide]);
  const sections = useMemo(() => searchGuide(guide, query, answers, locale), [guide, query, answers, locale]);
  const progress = useMemo(() => progressOf(answers, locale), [answers, locale]);
  const groups = useMemo(() => answeredGroups(answers, locale), [answers, locale]);
  const searching = query.trim() !== '';
  const found = sections.reduce((n, s) => n + s.subs.length, 0);
  const savedAt = conventions.updatedAt ? new Date(conventions.updatedAt).toLocaleDateString(locale, { dateStyle: 'medium' }) : '';

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700 p-6 text-white shadow-sm sm:p-8">
        <div className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/80">{t('gl.kicker')}</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">{t('gl.title')}</h2>
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
      </section>

      {loaded && (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6" aria-label={t(progress.answered > 0 ? 'gl.tailored.title' : 'gl.standard.title')}>
          {progress.answered > 0 ? (
            <div className="grid items-center gap-6 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,20rem)]">
              <ProgressRing answered={progress.answered} total={progress.total} label={t('glq.ring', { answered: progress.answered, total: progress.total })} />
              <div>
                <h3 className="text-base font-semibold text-slate-900">{t('gl.tailored.title')}</h3>
                <p className="mt-1 text-sm text-slate-600">{t('gl.tailored.text', { answered: progress.answered, total: progress.total })}</p>
                {savedAt && <p className="mt-1 text-xs text-slate-500">{t('gl.tailored.savedAt', { at: savedAt })}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => jumpTo('conventions')} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    {t('gl.conventions.nav')}
                  </button>
                  <Link to={PATHS.conventions} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
                    {t('gl.edit')}
                  </Link>
                </div>
              </div>
              <MeterList rows={progress.byCategory.map((c) => ({ name: c.label, value: c.answered, of: c.total, text: `${c.answered} / ${c.total}` }))} />
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">{t('gl.standard.title')}</h3>
                <p className="mt-1 max-w-2xl text-sm text-slate-600">
                  {t('gl.standard.text')}
                  {` ${t('gl.standard.hint')}`}
                </p>
              </div>
              <Link to={PATHS.conventions} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
                {t('gl.tailor')}
              </Link>
            </div>
          )}
        </section>
      )}

      <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-white/95 p-2 shadow-sm ring-1 ring-slate-200 backdrop-blur">
        <nav aria-label={t('gl.contents')} className="flex flex-wrap gap-1">
          {guide.map((s) => (
            <button key={s.id} type="button" onClick={() => jumpTo(s.id)} className="rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
              <span className="mr-1.5 font-mono text-xs font-semibold text-blue-700">{s.num}</span>
              {s.title}
            </button>
          ))}
        </nav>
        <div className="ml-auto min-w-36 flex-1 sm:max-w-52">
          <label className="sr-only" htmlFor="guidelines-search">
            {t('gl.search.label')}
          </label>
          <input
            id="guidelines-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('gl.search.placeholder')}
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-800"
          />
        </div>
      </div>

      {searching && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600" role="status">
          {found > 0 ? t('gl.search.count', { count: found }) : t('gl.search.none')}
          <button type="button" onClick={() => setQuery('')} className="text-blue-700 underline underline-offset-2">
            {t('gl.search.clear')}
          </button>
        </div>
      )}

      <GuideBody sections={sections} answers={answers} t={t} locale={locale} />

      {!searching && groups.length > 0 && (
        <section id={anchor('conventions')} aria-labelledby="guideline-conventions-title" className="scroll-mt-24 space-y-4">
          <div>
            <h3 id="guideline-conventions-title" className="text-xl font-semibold tracking-tight text-slate-900">
              {t('gl.conventions.title')}
            </h3>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">{t('gl.conventions.intro')}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {groups.map((group) => (
              <div key={group.category} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <h4 className="text-sm font-semibold text-blue-700">{group.category}</h4>
                <dl className="mt-2 divide-y divide-slate-100">
                  {group.items.map((item) => (
                    <div key={item.id} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-3 py-1.5 text-sm">
                      <dt className="text-slate-500">{item.label}</dt>
                      <dd className="break-words font-medium text-slate-900">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="border-t border-slate-200 pt-6">
        <p className="text-base font-medium text-slate-800">{t('gl.closing')}</p>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">{t('gl.sources')}</p>
      </footer>
    </div>
  );
}
