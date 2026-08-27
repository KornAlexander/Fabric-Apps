/**
 * The Great Library screen.
 *
 * A reference surface, not a trophy cabinet. It exists so a player can answer
 * "what do I actually know, and what am I avoiding", which means it has to be
 * willing to say unflattering things: unseen skills are listed first-class
 * rather than greyed out at the bottom, and lapses are shown next to the
 * successes rather than hidden behind them.
 *
 * All of the arithmetic lives in the learn layer's library model, which is
 * unit tested. This file only turns that model into markup, so the numbers on
 * screen cannot disagree with the numbers under test.
 */

import type { LibraryModel, LibrarySkillEntry, MasteryBand } from '@fabric-empires/learn';
import { createCoachPanel } from './coachPanel.js';

const STYLE = `
.fe-library {
  position: fixed; inset: 0; z-index: 45;
  background: rgba(6, 9, 15, 0.82);
  backdrop-filter: blur(4px);
  display: flex; align-items: flex-start; justify-content: center;
  overflow-y: auto; padding: 40px 20px;
  font: 13px/1.55 "Segoe UI", system-ui, sans-serif; color: #e8eaf0;
}
.fe-library[hidden] { display: none; }
.fe-lib-sheet {
  width: min(940px, 96vw);
  background: #10141c;
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 14px;
  box-shadow: 0 24px 70px rgba(0,0,0,0.6);
  padding: 22px 26px 30px;
}
.fe-lib-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.fe-lib-head h2 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: .01em; }
.fe-lib-close {
  background: #1d2636; color: #e8eaf0; border: 1px solid rgba(255,255,255,0.14);
  border-radius: 8px; padding: 6px 14px; cursor: pointer; font: inherit;
}
.fe-lib-close:hover { background: #26324a; }
.fe-lib-summary { margin: 10px 0 4px; color: #cdd4e2; }
.fe-lib-metrics { display: flex; flex-wrap: wrap; gap: 22px; margin: 14px 0 6px; }
.fe-lib-metric b { display: block; font-size: 22px; font-variant-numeric: tabular-nums; }
.fe-lib-metric span { color: #96a0b5; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
.fe-lib-legend { display: flex; gap: 14px; margin: 10px 0 18px; color: #96a0b5; font-size: 11px; }

.fe-lib-branch { margin-top: 22px; border-top: 1px solid rgba(255,255,255,0.09); padding-top: 14px; }
.fe-lib-branch h3 { margin: 0 0 2px; font-size: 15px; font-weight: 600; }
.fe-lib-weight { color: #96a0b5; font-weight: 400; font-size: 12px; }
.fe-lib-bar { height: 7px; border-radius: 4px; overflow: hidden; display: flex; margin: 8px 0 4px; background: rgba(255,255,255,0.06); }
.fe-lib-bar i { display: block; height: 100%; }
.fe-lib-cluster { margin-top: 14px; }
.fe-lib-cluster h4 { margin: 0 0 6px; font-size: 12px; font-weight: 600; color: #b9c1d1; text-transform: uppercase; letter-spacing: .06em; }

.fe-lib-skill {
  /*
   * Every column is minmax(0, ...) on purpose. With a bare \`auto\` final
   * column, a skill whose questions cite three long documentation paths made
   * the links column grow until the label beside it was squeezed into a
   * one-word-per-line ribbon. Capping the links and letting them wrap keeps
   * the thing the learner is reading in charge of the width.
   */
  display: grid; grid-template-columns: 84px minmax(0, 1fr) minmax(0, 300px);
  gap: 12px; align-items: baseline;
  padding: 7px 0; border-top: 1px solid rgba(255,255,255,0.05);
}
.fe-lib-skill.due { background: rgba(255, 209, 102, 0.07); }
.fe-lib-band {
  font-size: 10px; text-transform: uppercase; letter-spacing: .07em;
  border-radius: 999px; padding: 2px 8px; text-align: center; border: 1px solid;
}
.fe-lib-band.unseen   { color: #7c8699; border-color: rgba(124,134,153,0.5); }
.fe-lib-band.learning { color: #ffcf7a; border-color: rgba(255,207,122,0.5); }
.fe-lib-band.familiar { color: #8fd694; border-color: rgba(143,214,148,0.5); }
.fe-lib-band.strong   { color: #6fe0d0; border-color: rgba(111,224,208,0.6); }
.fe-lib-label { color: #e8eaf0; }
.fe-lib-note { color: #96a0b5; font-size: 11px; margin-top: 2px; }
.fe-lib-note .due-flag { color: #ffd166; }
.fe-lib-note .lapse { color: #ff9b91; }
.fe-lib-links { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
.fe-lib-links a { color: #8ab4ff; text-decoration: none; font-size: 11px; white-space: nowrap; }
.fe-lib-links a:hover { text-decoration: underline; }
.fe-lib-label { overflow-wrap: anywhere; }
.fe-lib-foot { margin-top: 20px; color: #7c8699; font-size: 11px; }
`;

const BAND_COLOUR: Record<MasteryBand, string> = {
  unseen: 'rgba(124,134,153,0.35)',
  learning: '#e0a94a',
  familiar: '#5aa864',
  strong: '#3fb8a6',
};

const BAND_ORDER: readonly MasteryBand[] = ['strong', 'familiar', 'learning', 'unseen'];

export interface GreatLibrary {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** "in 3 days", "today", "6 days ago". */
function relativeDay(when: number, now: number): string {
  const days = Math.round((when - now) / 86_400_000);
  if (days === 0) return 'today';
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`;
  return `${-days} day${days === -1 ? '' : 's'} ago`;
}

/**
 * The one-line story for a skill.
 *
 * Written to be readable rather than complete: a learner scanning 41 rows
 * needs the state and the next action, not a dump of the SM-2 record.
 */
function noteFor(skill: LibrarySkillEntry, now: number): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const parts: string[] = [];

  if (skill.band === 'unseen') {
    parts.push(
      skill.questionCount === 1
        ? 'never studied, 1 question waiting'
        : `never studied, ${skill.questionCount} questions waiting`,
    );
  } else {
    parts.push(`${skill.reviews} review${skill.reviews === 1 ? '' : 's'}`);
    if (skill.intervalDays > 0) parts.push(`interval ${skill.intervalDays}d`);
  }
  if (skill.researched) parts.push('researched');

  fragment.append(document.createTextNode(parts.join(' · ')));

  if (skill.lapses > 0) {
    fragment.append(document.createTextNode(' · '));
    const lapse = el('span', 'lapse', `forgotten ${skill.lapses}×`);
    fragment.append(lapse);
  }
  if (skill.due) {
    fragment.append(document.createTextNode(' · '));
    fragment.append(el('span', 'due-flag', 'due now'));
  } else if (skill.nextReview !== undefined) {
    fragment.append(document.createTextNode(` · next ${relativeDay(skill.nextReview, now)}`));
  }

  return fragment;
}

/**
 * Shorten a docs URL to its last path segment.
 *
 * The full path is kept on the title attribute. Segment names like
 * "roles-workspaces" or "incremental-refresh-configure" are already
 * self-describing, and showing two segments made rows wide enough to fight
 * the label for space.
 */
function linkLabel(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? url;
  } catch {
    return url;
  }
}

export function createGreatLibrary(
  provide: () => { model: LibraryModel; summary: string; now: number },
): GreatLibrary {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const root = el('div', 'fe-library');
  root.hidden = true;
  document.body.append(root);

  /*
   * The coach lives here rather than on the map.
   *
   * This is the screen a player already opens to ask "how am I doing", so the
   * answer to "what should I do about it" belongs on the same sheet. Built
   * once and updated, not rebuilt per render, so a conversation survives the
   * Library being closed and reopened.
   */
  const coach = createCoachPanel();

  let open = false;

  function bandBar(bands: Record<MasteryBand, number>, total: number): HTMLElement {
    const bar = el('div', 'fe-lib-bar');
    for (const band of BAND_ORDER) {
      const count = bands[band];
      if (count === 0) continue;
      const segment = el('i');
      segment.style.width = `${(count / Math.max(1, total)) * 100}%`;
      segment.style.background = BAND_COLOUR[band];
      segment.title = `${count} ${band}`;
      bar.append(segment);
    }
    return bar;
  }

  function render(): void {
    const { model, summary, now } = provide();
    root.replaceChildren();

    const sheet = el('div', 'fe-lib-sheet');

    const head = el('div', 'fe-lib-head');
    head.append(el('h2', undefined, 'The Great Library'));
    const close = el('button', 'fe-lib-close', 'Close');
    close.addEventListener('click', () => api.close());
    head.append(close);
    sheet.append(head);

    sheet.append(el('p', 'fe-lib-summary', summary));

    coach.update(model);
    sheet.append(coach.root);

    const metrics = el('div', 'fe-lib-metrics');
    const metric = (value: string, label: string) => {
      const wrap = el('div', 'fe-lib-metric');
      wrap.append(el('b', undefined, value));
      wrap.append(el('span', undefined, label));
      return wrap;
    };
    metrics.append(metric(`${Math.round(model.examRetained * 100)}%`, 'exam retained'));
    metrics.append(metric(`${Math.round(model.examSeen * 100)}%`, 'exam seen'));
    metrics.append(
      metric(`${model.bands.familiar + model.bands.strong}/${model.totalSkills}`, 'skills retained'),
    );
    metrics.append(metric(String(model.dueNow), 'due now'));
    metrics.append(metric(String(model.researched), 'researched'));
    sheet.append(metrics);

    const legend = el('div', 'fe-lib-legend');
    for (const band of BAND_ORDER) {
      const item = el('span', undefined, `${band} ${model.bands[band]}`);
      item.style.color = BAND_COLOUR[band];
      legend.append(item);
    }
    sheet.append(legend);

    for (const branch of model.branches) {
      const section = el('div', 'fe-lib-branch');
      const title = el('h3');
      title.append(document.createTextNode(`${branch.id}. ${branch.label} `));
      title.append(
        el('span', 'fe-lib-weight', `${branch.weightMin} to ${branch.weightMax} percent of the exam`),
      );
      section.append(title);

      const skillCount = branch.clusters.reduce((n, c) => n + c.skills.length, 0);
      section.append(bandBar(branch.bands, skillCount));

      for (const cluster of branch.clusters) {
        const group = el('div', 'fe-lib-cluster');
        group.append(el('h4', undefined, `${cluster.id} · ${cluster.label}`));

        for (const skill of cluster.skills) {
          const row = el('div', `fe-lib-skill${skill.due ? ' due' : ''}`);
          row.append(el('span', `fe-lib-band ${skill.band}`, skill.band));

          const middle = el('div');
          middle.append(el('div', 'fe-lib-label', skill.label));
          const note = el('div', 'fe-lib-note');
          note.append(noteFor(skill, now));
          middle.append(note);
          row.append(middle);

          const links = el('div', 'fe-lib-links');
          for (const url of skill.links) {
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.target = '_blank';
            anchor.rel = 'noreferrer noopener';
            anchor.textContent = linkLabel(url);
            anchor.title = url;
            links.append(anchor);
          }
          row.append(links);

          group.append(row);
        }
        section.append(group);
      }
      sheet.append(section);
    }

    sheet.append(
      el(
        'div',
        'fe-lib-foot',
        'Bands come from the spaced repetition schedule: learning is seen once, ' +
          'familiar is two successful recalls, strong is four with an interval past three weeks. ' +
          'Researching a skill unlocks it in the game; retaining it is a separate claim.',
      ),
    );

    root.append(sheet);
  }

  // Clicking the dimmed background closes, which is the convention people
  // already expect from a full-screen overlay.
  root.addEventListener('click', (event) => {
    if (event.target === root) api.close();
  });

  window.addEventListener('keydown', (event) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      api.close();
    }
  });

  const api: GreatLibrary = {
    open() {
      render();
      root.hidden = false;
      open = true;
    },
    close() {
      root.hidden = true;
      open = false;
    },
    toggle() {
      if (open) api.close();
      else api.open();
    },
    isOpen: () => open,
  };

  return api;
}
