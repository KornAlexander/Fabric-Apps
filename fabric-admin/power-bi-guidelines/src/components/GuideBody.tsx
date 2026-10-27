/**
 * The guide itself: areas, topics, rules and drawings. The app and the plain
 * HTML files both render it, so their wording cannot drift apart.
 */
import { useCallback, type ReactElement } from 'react';

import { type GuideItem, type GuideLink, type GuideSection, type GuideSub, type SectionIcon } from '@/guidelines/content';
import { teamAnswer } from '@/guidelines/conventions';
import { FIGURE_PLACES, type FigureId } from '@/guidelines/figureIds';
import { Figure } from '@/guidelines/figureRegistry';
import { countRules, textParts, tokensIn } from '@/guidelines/guide';
import type { Answer } from '@/guidelines/questions';
import type { Locale, Translate } from '@/i18n';

const ICONS: Record<SectionIcon, ReactElement> = {
  integration: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.8" />
      <path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6" />
    </>
  ),
  modeling: (
    <>
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <rect x="2.5" y="2.5" width="5" height="5" rx="1" />
      <rect x="16.5" y="2.5" width="5" height="5" rx="1" />
      <rect x="2.5" y="16.5" width="5" height="5" rx="1" />
      <rect x="16.5" y="16.5" width="5" height="5" rx="1" />
      <path d="M7.5 7.5 9 9M16.5 7.5 15 9M7.5 16.5 9 15M16.5 16.5 15 15" />
    </>
  ),
  report: <path d="M4 20V4M4 20h16M8 17v-6M12 17V7M16 17v-4" />,
};

function Icon({ name }: { name: SectionIcon }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/** The id of an area on the page, for links into the guide. */
export const anchor = (id: string) => `guideline-${id}`;

/** The id of a topic on the page. */
export const topicAnchor = (num: string) => `topic-${num.replace(/\./g, '-')}`;

/** A text with the organization's answers filled in and marked. */
function Filled({ text, answers, t, locale }: { text: string; answers: Record<string, Answer>; t: Translate; locale: Locale }) {
  return (
    <>
      {textParts(text, answers, locale).map((part, index) =>
        part.kind === 'text' ? (
          <span key={index}>{part.text}</span>
        ) : part.kind === 'team' ? (
          <mark key={index} title={t('gl.teamValue')} className="rounded bg-blue-50 px-1 font-semibold break-words text-blue-800 ring-1 ring-inset ring-blue-600/20">
            {part.text}
          </mark>
        ) : (
          <span key={index} title={t('gl.defaultValue')} className="border-b border-dotted border-slate-400 text-slate-600">
            {part.text}
          </span>
        )
      )}
    </>
  );
}

function External({ link, t }: { link: GuideLink; t: Translate }) {
  return (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-700">
      {link.label}
      <span aria-hidden="true">{' ↗'}</span>
      <span className="sr-only">{` (${t('gl.external')})`}</span>
    </a>
  );
}

function Items({
  items,
  answers,
  nested,
  t,
  locale,
  draw,
}: {
  items: readonly GuideItem[];
  answers: Record<string, Answer>;
  nested?: boolean;
  t: Translate;
  locale: Locale;
  /** Draws one drawing; only rules of the first level carry any. */
  draw?: (id: FigureId) => ReactElement;
}) {
  return (
    <ul className={nested ? 'mt-2 space-y-1.5 border-l-2 border-slate-200 pl-4' : 'space-y-2.5'}>
      {items.map((item, index) => {
        // The answer is shown beside the rule unless the text already carries it.
        const inline = [...tokensIn(item.title), ...tokensIn(item.text)];
        const team = item.q && !inline.includes(item.q) ? teamAnswer(answers, item.q, locale) : null;
        const heading = item.marker === '' && !item.text;
        const drawings = draw && item.place ? (FIGURE_PLACES[item.place] ?? []) : [];
        return (
          <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-slate-700">
            {item.marker !== '' && <span className="w-5 shrink-0 font-mono text-xs leading-6 text-slate-400">{item.marker ?? '•'}</span>}
            <div className="min-w-0 flex-1">
              {item.title && (
                <strong className={`font-semibold text-slate-900 ${heading ? 'text-[0.9375rem]' : ''}`}>
                  <Filled text={item.title} answers={answers} t={t} locale={locale} />
                  {item.text && !/[.:?!]$/.test(item.title) && '.'}
                </strong>
              )}
              {item.title && item.text && ' '}
              {item.text && <Filled text={item.text} answers={answers} t={t} locale={locale} />}
              {item.link && (
                <>
                  {' '}
                  <External link={item.link} t={t} />
                </>
              )}
              {team && (
                <span className="ml-2 inline-block max-w-full rounded-xl bg-blue-50 px-2 py-0.5 align-middle text-xs font-medium break-words text-blue-800 ring-1 ring-inset ring-blue-600/20">
                  <span className="font-normal text-blue-700">{`${t('gl.yours')}: `}</span>
                  {team}
                </span>
              )}
              {item.children && <Items items={item.children} answers={answers} nested t={t} locale={locale} />}
              {drawings.length > 0 && <div className="mt-3 mb-2 space-y-3">{drawings.map((id) => draw?.(id))}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Heading levels: under the app's page title areas are h3; in a document of their own, h2. */
export type Outline = 'page' | 'document';

function Topic({ sub, answers, t, locale, outline }: { sub: GuideSub; answers: Record<string, Answer>; t: Translate; locale: Locale; outline: Outline }) {
  const Heading = outline === 'document' ? 'h3' : 'h4';
  const team = useCallback((qid: string) => teamAnswer(answers, qid, locale), [answers, locale]);
  const stored = useCallback((qid: string) => teamAnswer(answers, qid), [answers]);
  const draw = (id: FigureId) => <Figure key={id} id={id} team={team} stored={stored} locale={locale} />;
  const topicDrawings = FIGURE_PLACES[sub.num] ?? [];
  return (
    <article id={topicAnchor(sub.num)} className="scroll-mt-24 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
      <header className="flex items-baseline gap-3">
        <span className="font-mono text-sm font-semibold text-blue-700">{sub.num}</span>
        <Heading className="text-base font-semibold text-slate-900">{sub.title}</Heading>
      </header>
      {(sub.intro || sub.link) && (
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          {sub.intro && <Filled text={sub.intro} answers={answers} t={t} locale={locale} />}
          {sub.link && (
            <>
              {' '}
              <External link={sub.link} t={t} />
            </>
          )}
        </p>
      )}
      {topicDrawings.length > 0 && <div className="mt-4 space-y-3">{topicDrawings.map(draw)}</div>}
      {sub.items.length > 0 && (
        <div className="mt-4">
          <Items items={sub.items} answers={answers} t={t} locale={locale} draw={draw} />
        </div>
      )}
    </article>
  );
}

function Area({ section, answers, t, locale, outline }: { section: GuideSection; answers: Record<string, Answer>; t: Translate; locale: Locale; outline: Outline }) {
  const Heading = outline === 'document' ? 'h2' : 'h3';
  const rules = section.subs.reduce((n, sub) => n + countRules(sub.items), 0);
  return (
    <section id={anchor(section.id)} aria-labelledby={`${anchor(section.id)}-title`} className="scroll-mt-24 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
          <Icon name={section.icon} />
        </span>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('gl.area', { num: section.num })}</p>
          <Heading id={`${anchor(section.id)}-title`} className="text-xl font-semibold tracking-tight text-slate-900">
            {section.title}
          </Heading>
        </div>
        <span className="ml-auto text-xs text-slate-500">{t('gl.rules', { count: rules })}</span>
      </div>
      {section.subs.map((sub) => (
        <Topic key={sub.num} sub={sub} answers={answers} t={t} locale={locale} outline={outline} />
      ))}
    </section>
  );
}

/** Every area of the guide, in order, with the team's answers filled in. */
export function GuideBody({ sections, answers, t, locale, outline = 'page' }: { sections: readonly GuideSection[]; answers: Record<string, Answer>; t: Translate; locale: Locale; outline?: Outline }) {
  return (
    <>
      {sections.map((section) => (
        <Area key={section.id} section={section} answers={answers} t={t} locale={locale} outline={outline} />
      ))}
    </>
  );
}
