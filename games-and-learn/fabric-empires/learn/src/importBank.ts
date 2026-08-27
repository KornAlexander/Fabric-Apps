/**
 * Bring your own curriculum.
 *
 * A spreadsheet of questions becomes a playable course. That turns this from a
 * DP-600 study aid into a study aid that happens to ship with DP-600 in it, and
 * it is the same machinery the Klasse 1 bank already uses: a campaign with
 * `role: 'questions'` supplies questions without claiming to build a world, so
 * a file with nine questions in it is as valid as one with nine hundred.
 *
 * ⚠️ **This takes a plain grid of cells, not a file.** Reading `.xlsx` needs a
 * library and reading `.csv` needs a parser, and neither belongs in here: what
 * belongs in here is what a row MEANS, which is the part worth testing and the
 * part that has nothing to do with either format. The app hands it
 * `string[][]` from whichever reader ran.
 *
 * ⚠️ **Imported questions go through the same hashing and encryption as the
 * shipped bank.** There is nothing to protect in somebody's own file, so that
 * looks like pointless work; it is not. It means an imported question is
 * byte-for-byte the same shape as a built one, so `checkAnswer`,
 * `revealCorrectAnswer` and `decryptExplanation` need no idea where it came
 * from, and there is no second code path to keep correct.
 */

import { encryptExplanation, hashAnswer } from './crypto.js';
import type { Campaign } from './campaign.js';
import type { Outline } from './outline.js';
import type { Question, QuestionTier, QuestionType } from './questions.js';

/**
 * The columns, in the order the template writes them.
 *
 * Matched case-insensitively and with surrounding space ignored, because a
 * spreadsheet that has been round-tripped through three people has usually
 * grown a capital letter somewhere.
 */
export const IMPORT_COLUMNS = Object.freeze([
  'topic',
  'question',
  'answer',
  'wrong1',
  'wrong2',
  'wrong3',
  'explanation',
]);

/** One thing wrong with one row, in terms of the spreadsheet the author sees. */
export interface RowProblem {
  /** 1-based, and counting the header, so it matches what Excel shows. */
  readonly row: number;
  readonly message: string;
}

export interface BankPreview {
  /** Questions that would be imported. */
  readonly questions: readonly ImportedDraft[];
  /** Distinct topic names, in the order they first appear. */
  readonly topics: readonly string[];
  /** Rows that could not be used, and why. */
  readonly problems: readonly RowProblem[];
  /** Rows that were used but are worth mentioning. */
  readonly warnings: readonly RowProblem[];
  /** Header names that were not recognised. */
  readonly unknownColumns: readonly string[];
  /** Rows in the file, not counting the header or blank lines. */
  readonly rowsRead: number;
}

export interface ImportedDraft {
  readonly topic: string;
  readonly stem: string;
  readonly answer: string;
  readonly wrong: readonly string[];
  readonly explanation: string;
  readonly row: number;
}

const cell = (row: readonly unknown[], at: number): string =>
  at < 0 || row[at] === undefined || row[at] === null ? '' : String(row[at]).trim();

/**
 * Read a grid into a preview.
 *
 * ⚠️ **Nothing is imported here, and that is the point.** Campus-Scheduler
 * learned this the expensive way and wrote it down: a sheet that blocked four
 * slots a lecturer was teaching in previewed as "4 changes" and said nothing
 * about the four lectures it was about to invalidate. *A count of edits is not
 * a description of consequences.* So this returns what would happen, in the
 * author's own terms, and the caller decides whether to go ahead.
 */
export function previewBank(grid: readonly (readonly unknown[])[]): BankPreview {
  const problems: RowProblem[] = [];
  const warnings: RowProblem[] = [];

  const rows = grid.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (rows.length === 0) {
    return {
      questions: [],
      topics: [],
      problems: [{ row: 1, message: 'The file is empty.' }],
      warnings: [],
      unknownColumns: [],
      rowsRead: 0,
    };
  }

  const header = (rows[0] ?? []).map((c) => String(c ?? '').trim().toLowerCase());
  const at = (name: string): number => header.indexOf(name);
  const unknownColumns = header.filter((h) => h !== '' && !IMPORT_COLUMNS.includes(h));

  for (const required of ['topic', 'question', 'answer']) {
    if (at(required) < 0) {
      problems.push({
        row: 1,
        message: `The file has no "${required}" column. Download the sample to see the columns.`,
      });
    }
  }
  if (problems.length > 0) {
    return { questions: [], topics: [], problems, warnings, unknownColumns, rowsRead: 0 };
  }

  const questions: ImportedDraft[] = [];
  const topics: string[] = [];
  const seenStems = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    // ⚠️ +1 because a spreadsheet counts from 1, and an author reading this is
    // looking at Excel, not at an array.
    const line = i + 1;

    const topic = cell(row, at('topic'));
    const stem = cell(row, at('question'));
    const answer = cell(row, at('answer'));
    const wrong = [cell(row, at('wrong1')), cell(row, at('wrong2')), cell(row, at('wrong3'))]
      .filter((w) => w !== '');
    const explanation = cell(row, at('explanation'));

    if (!topic) {
      problems.push({ row: line, message: 'No topic, so there is nothing to file it under.' });
      continue;
    }
    if (!stem) {
      problems.push({ row: line, message: 'No question text.' });
      continue;
    }
    if (!answer) {
      problems.push({ row: line, message: 'No answer, so it cannot be marked.' });
      continue;
    }
    if (wrong.length === 0) {
      problems.push({
        row: line,
        message: 'No wrong answers, so there would be nothing to choose between.',
      });
      continue;
    }
    if (wrong.some((w) => w.toLowerCase() === answer.toLowerCase())) {
      problems.push({ row: line, message: 'A wrong answer is the same as the right one.' });
      continue;
    }

    const key = stem.toLowerCase();
    if (seenStems.has(key)) {
      warnings.push({ row: line, message: 'The same question appears earlier in the file.' });
    }
    seenStems.add(key);

    if (!explanation) {
      warnings.push({
        row: line,
        message: 'No explanation, so getting it wrong teaches nothing.',
      });
    }

    if (!topics.includes(topic)) topics.push(topic);
    questions.push({ topic, stem, answer, wrong, explanation, row: line });
  }

  return {
    questions,
    topics,
    problems,
    warnings,
    unknownColumns,
    rowsRead: rows.length - 1,
  };
}

/** A name safe to use in an id. */
function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'custom'
  );
}

/**
 * Turn a preview into a real campaign.
 *
 * Async because hashing and encryption are, and they are what make an imported
 * question the same shape as a shipped one.
 */
export async function buildImportedCampaign(
  title: string,
  preview: BankPreview,
): Promise<Campaign> {
  const id = `custom-${slug(title)}`;
  const questions: Question[] = [];

  for (const [index, draft] of preview.questions.entries()) {
    const skillId = preview.topics.indexOf(draft.topic) + 1;
    const questionId = `${id}-${index + 1}`;
    // The options are shuffled deterministically from the question's own id, so
    // the right answer is not always first and the order is the same every time
    // the same file is imported.
    const options = shuffle([draft.answer, ...draft.wrong], questionId);

    questions.push({
      id: questionId,
      cert: id,
      branch: 'C',
      cluster: `C${skillId}`,
      skillId,
      type: 'mcq' as QuestionType,
      tier: 1 as QuestionTier,
      stem: draft.stem,
      options,
      answerHash: await hashAnswer(questionId, draft.answer),
      explanationCipher: await encryptExplanation(
        questionId,
        draft.answer,
        draft.explanation || 'No explanation was given for this question.',
      ),
      learnUrl: '',
      sourceSkillBullet: draft.topic,
      sourceLearnUrl: '',
      reviewStatus: 'draft',
      tags: ['imported'],
    });
  }

  /*
   * An outline with one branch and a cluster per topic.
   *
   * The shape is the real `Outline`, not something close to it, so the rest of
   * the system cannot tell an imported course from a written one. `weightMin`
   * and `weightMax` are the published exam weighting for a certification and
   * mean nothing here, so they say 100: this course is all of itself.
   */
  const outline: Outline = {
    cert: id,
    title,
    revision: new Date().toISOString().slice(0, 10),
    source: 'Imported from a spreadsheet',
    branches: [
      {
        id: 'C',
        label: title,
        weightMin: 100,
        weightMax: 100,
        clusters: preview.topics.map((topic, i) => ({
          id: `C${i + 1}`,
          label: topic,
          skills: [{ id: i + 1, label: topic }],
        })),
      },
    ],
  };

  return Object.freeze({
    id,
    title,
    course: title,
    blurb: `${questions.length} questions from your own file, across ${preview.topics.length} topics.`,
    language: 'en',
    role: 'questions',
    outline,
    questions,
    antagonists: [],
    exam: {
      length: Math.max(1, Math.min(10, questions.length)),
      passMark: 0.7,
      threshold: 0.8,
      questionMs: 45_000,
    },
  });
}

/** Deterministic shuffle, so the same file always imports the same way. */
function shuffle(items: readonly string[], seed: string): string[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The sample file, as a grid.
 *
 * ⚠️ **Filled in, not blank.** A template with only headers makes somebody
 * guess what belongs in a cell; a template with three real questions in it
 * answers that by example, and the first thing most people do is overwrite
 * row 2 and keep going. The examples are deliberately about this game rather
 * than about Fabric, so nobody mistakes them for exam content.
 */
export function sampleGrid(): string[][] {
  return [
    [...IMPORT_COLUMNS],
    [
      'Capital cities',
      'What is the capital of Germany?',
      'Berlin',
      'Munich',
      'Hamburg',
      'Cologne',
      'Berlin has been the capital of reunified Germany since 1990.',
    ],
    [
      'Capital cities',
      'What is the capital of Austria?',
      'Vienna',
      'Salzburg',
      'Graz',
      'Linz',
      'Vienna is on the Danube and has been the capital since the Habsburgs.',
    ],
    [
      'Times tables',
      'What is 7 times 8?',
      '56',
      '54',
      '48',
      '64',
      'Seven eights are fifty six.',
    ],
  ];
}
