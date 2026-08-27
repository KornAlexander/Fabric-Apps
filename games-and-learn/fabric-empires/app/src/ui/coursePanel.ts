/**
 * Bring your own questions.
 *
 * ⚠️ **Upload, then look, then decide.** The file is never applied on choosing
 * it. Campus-Scheduler learned that the expensive way and wrote it down: a
 * spreadsheet that blocked four slots a lecturer was teaching in previewed as
 * "4 changes" and said nothing about the four lectures it would invalidate.
 * *A count of edits is not a description of consequences.* So this reports
 * what the file contains, what it could not use and why, in the author's own
 * row numbers, and nothing happens until the button is pressed.
 */

import {
  buildImportedCampaign,
  previewBank,
  type BankPreview,
  type Campaign,
} from '@fabric-empires/learn';
import { downloadSample, readGrid } from '../spreadsheet.js';
import { bankAvailable, generateQuestions, saveBank } from '../questionShop.js';
import { t } from '../i18n.js';

export interface CoursePanel {
  readonly root: HTMLElement;
  /** Called when a course has been imported and should join the pickers. */
  onImported(handler: (campaign: Campaign) => void): void;
}

export function createCoursePanel(): CoursePanel {
  const root = document.createElement('div');
  root.className = 'fe-course';

  const heading = document.createElement('h3');
  heading.textContent = t('Your own questions');
  root.append(heading);

  const blurb = document.createElement('p');
  blurb.className = 'fe-setup-detail';
  blurb.textContent = t(
    'Download the sample, replace the rows with your own, and upload it. Any subject works.',
  );
  root.append(blurb);

  const buttons = document.createElement('div');
  buttons.className = 'fe-course-buttons';

  const download = document.createElement('button');
  download.type = 'button';
  download.textContent = t('Download sample');
  download.addEventListener('click', () => {
    void downloadSample().catch(() => {
      say(t('The sample could not be saved.'), 'bad');
    });
  });

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.textContent = t('Upload a file');

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.csv,.txt';
  input.hidden = true;
  pick.addEventListener('click', () => input.click());

  buttons.append(download, pick, input);
  root.append(buttons);

  const report = document.createElement('div');
  report.className = 'fe-course-report';
  root.append(report);

  /*
   * Writing questions for a topic nobody shipped.
   *
   * ⚠️ **Hidden until the host says it can.** The route only exists on the
   * capacity edition, so on a static build this whole block is absent rather
   * than present and broken, which is the same contract the coach chat and the
   * anthem both keep.
   */
  const forge = document.createElement('div');
  forge.className = 'fe-course-forge';
  forge.hidden = true;

  const forgeHeading = document.createElement('h4');
  forgeHeading.textContent = t('Or write questions for a new topic');
  const forgeBlurb = document.createElement('p');
  forgeBlurb.className = 'fe-setup-detail';
  forgeBlurb.textContent = t(
    'A model drafts them and you read them before anything is kept. Check the answers: it can be confidently wrong.',
  );

  const topicInput = document.createElement('input');
  topicInput.type = 'text';
  topicInput.placeholder = t('A topic, for example: Delta Lake table maintenance');
  topicInput.setAttribute('aria-label', t('Topic'));

  const countInput = document.createElement('input');
  countInput.type = 'number';
  countInput.min = '1';
  countInput.max = '20';
  countInput.value = '8';
  countInput.setAttribute('aria-label', t('How many questions'));

  const write = document.createElement('button');
  write.type = 'button';
  write.textContent = t('Draft questions');
  write.addEventListener('click', () => {
    const topic = topicInput.value.trim();
    if (!topic) {
      say(t('Name a topic first.'), 'bad');
      return;
    }
    write.disabled = true;
    say(t('Writing questions about {topic}…', { topic }));
    void generateQuestions(topic, Number(countInput.value) || 8)
      .then((result) => {
        write.disabled = false;
        if (!result.ok) {
          pending = undefined;
          pendingGrid = undefined;
          say(result.error ?? t('No questions could be written.'), 'bad');
          return;
        }
        pendingGrid = result.grid;
        pendingName = topic;
        // ⚠️ The same preview an uploaded file gets. Generated rows are not
        // trusted further than a spreadsheet is, and there is no second path
        // into the bank that could be wrong in its own way.
        pending = previewBank(result.grid);
        showPreview(pending, topic);
      })
      .catch(() => {
        write.disabled = false;
        say(t('No questions could be written.'), 'bad');
      });
  });

  const forgeRow = document.createElement('div');
  forgeRow.className = 'fe-course-buttons';
  forgeRow.append(topicInput, countInput, write);
  forge.append(forgeHeading, forgeBlurb, forgeRow);
  root.append(forge);

  // Asked once, in the background. Nothing waits for it.
  void bankAvailable().then((available) => {
    forge.hidden = !available;
  });

  const handlers = new Set<(campaign: Campaign) => void>();
  let pending: BankPreview | undefined;
  let pendingName = '';
  /**
   * The grid behind the current preview, when it came from the model.
   *
   * Kept so it can be saved to the host after it has been looked at. Undefined
   * for an uploaded file, which already exists somewhere and does not need
   * this host to keep a copy.
   */
  let pendingGrid: string[][] | undefined;

  function say(message: string, tone: 'good' | 'bad' | 'plain' = 'plain'): void {
    report.replaceChildren();
    const line = document.createElement('div');
    line.className = `fe-course-note ${tone}`;
    line.textContent = message;
    report.append(line);
  }

  /** Show what the file would do, and offer to do it. */
  function showPreview(preview: BankPreview, name: string): void {
    report.replaceChildren();

    const summary = document.createElement('div');
    summary.className = 'fe-course-note';
    summary.textContent = t('{questions} questions across {topics} topics, from {file}.', {
      questions: preview.questions.length,
      topics: preview.topics.length,
      file: name,
    });
    report.append(summary);

    if (preview.topics.length > 0) {
      const topics = document.createElement('div');
      topics.className = 'fe-course-topics';
      topics.textContent = preview.topics.slice(0, 8).join(' · ');
      if (preview.topics.length > 8) topics.textContent += ' · …';
      report.append(topics);
    }

    /*
     * Problems and warnings, each with the row number the author sees in Excel.
     * Capped at six, because a file with forty broken rows has one broken idea
     * and a wall of text helps nobody find it.
     */
    for (const [items, tone, title] of [
      [preview.problems, 'bad', t('Rows that could not be used')],
      [preview.warnings, 'warn', t('Worth a look')],
    ] as const) {
      if (items.length === 0) continue;
      const box = document.createElement('div');
      box.className = `fe-course-issues ${tone}`;
      const head = document.createElement('b');
      head.textContent = `${title} (${items.length})`;
      box.append(head);
      for (const item of items.slice(0, 6)) {
        const line = document.createElement('div');
        line.textContent = t('Row {row}: {message}', { row: item.row, message: item.message });
        box.append(line);
      }
      if (items.length > 6) {
        const more = document.createElement('div');
        more.textContent = t('and {n} more', { n: items.length - 6 });
        box.append(more);
      }
      report.append(box);
    }

    if (preview.unknownColumns.length > 0) {
      const line = document.createElement('div');
      line.className = 'fe-course-note warn';
      line.textContent = t('Ignored columns: {columns}', {
        columns: preview.unknownColumns.join(', '),
      });
      report.append(line);
    }

    if (preview.questions.length === 0) {
      const line = document.createElement('div');
      line.className = 'fe-course-note bad';
      line.textContent = t('Nothing in this file can be played yet.');
      report.append(line);
      return;
    }

    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'fe-course-use';
    use.textContent = t('Use these questions');
    use.addEventListener('click', () => {
      void apply(name);
    });
    report.append(use);

    /*
     * Keeping them.
     *
     * ⚠️ Offered only after the preview, and only for generated rows. This is
     * the second half of "look, then decide": using them is this browser's
     * business, saving them puts them in front of everybody else who opens
     * the game on this host, and those are different decisions.
     */
    if (pendingGrid && pendingGrid.length > 1) {
      const keep = document.createElement('button');
      keep.type = 'button';
      keep.className = 'fe-course-use';
      keep.textContent = t('Save to the bank');
      keep.addEventListener('click', () => {
        const grid = pendingGrid;
        if (!grid) return;
        keep.disabled = true;
        void saveBank(name, grid).then((result) => {
          const line = document.createElement('div');
          line.className = `fe-course-note ${result.ok ? 'good' : 'bad'}`;
          line.textContent = result.ok
            ? t('Saved {n} questions to this host.', { n: result.saved })
            : (result.error ?? t('The bank could not be saved.'));
          report.append(line);
          keep.disabled = !result.ok ? false : true;
        });
      });
      report.append(keep);
    }
  }

  async function apply(name: string): Promise<void> {
    if (!pending) return;
    const title = name.replace(/\.(xlsx|csv|txt)$/i, '') || t('My questions');
    try {
      const campaign = await buildImportedCampaign(title, pending);
      pending = undefined;
      input.value = '';
      say(
        t('{title} is ready. Pick it as a course below.', { title: campaign.course }),
        'good',
      );
      for (const handler of handlers) handler(campaign);
    } catch {
      say(t('Those questions could not be prepared.'), 'bad');
    }
  }

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    pendingName = file.name;
    pendingGrid = undefined;
    say(t('Reading {file}…', { file: file.name }));
    void readGrid(file)
      .then((grid) => {
        pending = previewBank(grid);
        showPreview(pending, pendingName);
      })
      .catch((error: unknown) => {
        pending = undefined;
        // Shown plainly to the player, and logged in full for whoever has to
        // work out why somebody's spreadsheet will not open.
        console.error('Could not read the uploaded file', error);
        say(t('That file could not be read. Excel and CSV both work.'), 'bad');
      });
  });

  return {
    root,
    onImported(handler) {
      handlers.add(handler);
    },
  };
}
