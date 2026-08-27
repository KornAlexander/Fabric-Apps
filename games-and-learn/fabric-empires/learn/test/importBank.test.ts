/**
 * Importing somebody else's questions.
 *
 * ⚠️ **The rule these tests exist to defend is that the preview describes
 * consequences, not counts.** Campus-Scheduler learned it the expensive way and
 * wrote it in its own source: a spreadsheet that blocked four slots a lecturer
 * was teaching in previewed as "4 changes" and said nothing about the four
 * lectures it was about to invalidate. A file somebody typed by hand is going
 * to have mistakes in it, and the useful thing to say is which row and why.
 */

import { describe, expect, it } from 'vitest';
import {
  IMPORT_COLUMNS,
  buildImportedCampaign,
  checkAnswer,
  decryptExplanation,
  previewBank,
  sampleGrid,
  validateCampaign,
} from '../src/index.js';

const header = [...IMPORT_COLUMNS];
const good = (topic: string, q: string, a: string) => [
  topic,
  q,
  a,
  'wrong one',
  'wrong two',
  'wrong three',
  'because that is how it is',
];

describe('the sample file', () => {
  it('has the columns the importer looks for', () => {
    expect(sampleGrid()[0]).toEqual(header);
  });

  it('⚠️ is filled in, not blank', () => {
    /*
     * A template with only headers makes somebody guess what belongs in a
     * cell. The first thing most people do with one that has rows in it is
     * overwrite row two and keep going.
     */
    expect(sampleGrid().length).toBeGreaterThan(2);
  });

  it('imports cleanly, which is the least a sample can do', () => {
    const preview = previewBank(sampleGrid());
    expect(preview.problems).toEqual([]);
    expect(preview.warnings).toEqual([]);
    expect(preview.questions.length).toBe(sampleGrid().length - 1);
  });

  it('is about anything except the exam', () => {
    // So nobody mistakes the examples for DP-600 content and revises them.
    const text = JSON.stringify(sampleGrid()).toLowerCase();
    for (const term of ['fabric', 'lakehouse', 'dax', 'direct lake', 'semantic']) {
      expect(text, `the sample mentions ${term}`).not.toContain(term);
    }
  });
});

describe('reading a grid', () => {
  it('groups questions by topic, in the order the topics appear', () => {
    const preview = previewBank([
      header,
      good('Rivers', 'Longest river?', 'Nile'),
      good('Mountains', 'Highest mountain?', 'Everest'),
      good('Rivers', 'Widest river?', 'Amazon'),
    ]);
    expect(preview.topics).toEqual(['Rivers', 'Mountains']);
    expect(preview.questions).toHaveLength(3);
  });

  it('ignores the case and spacing of the column names', () => {
    const preview = previewBank([
      ['  Topic ', 'QUESTION', 'Answer', 'Wrong1', 'Wrong2', 'Wrong3', 'Explanation'],
      good('Rivers', 'Longest river?', 'Nile'),
    ]);
    expect(preview.problems).toEqual([]);
    expect(preview.questions).toHaveLength(1);
  });

  it('skips blank lines rather than counting them as broken rows', () => {
    const preview = previewBank([
      header,
      good('Rivers', 'Longest river?', 'Nile'),
      ['', '', '', '', '', '', ''],
      good('Rivers', 'Widest river?', 'Amazon'),
    ]);
    expect(preview.problems).toEqual([]);
    expect(preview.rowsRead).toBe(2);
  });

  it('works with only one wrong answer', () => {
    // Two options is a real question. Demanding four would reject a true/false
    // bank, which is exactly what a teacher is likeliest to bring first.
    const preview = previewBank([
      header,
      ['Rivers', 'Is the Nile in Africa?', 'Yes', 'No', '', '', ''],
    ]);
    expect(preview.problems).toEqual([]);
    expect(preview.questions[0]!.wrong).toEqual(['No']);
  });
});

describe('⚠️ what it says about a broken file', () => {
  it('names the row an author would see in Excel', () => {
    const preview = previewBank([
      header,
      good('Rivers', 'Longest river?', 'Nile'),
      ['Rivers', '', 'Amazon', 'Nile', '', '', ''],
    ]);
    // Header is row 1, first question row 2, the broken one row 3.
    expect(preview.problems).toEqual([{ row: 3, message: 'No question text.' }]);
  });

  it('says why, in words about the file rather than about the code', () => {
    const preview = previewBank([
      header,
      ['', 'Longest river?', 'Nile', 'Amazon', '', '', ''],
      ['Rivers', 'Longest river?', '', 'Amazon', '', '', ''],
      ['Rivers', 'Widest river?', 'Amazon', '', '', '', ''],
    ]);
    expect(preview.problems.map((p) => p.message)).toEqual([
      'No topic, so there is nothing to file it under.',
      'No answer, so it cannot be marked.',
      'No wrong answers, so there would be nothing to choose between.',
    ]);
  });

  it('catches a wrong answer that is also the right one', () => {
    const preview = previewBank([
      header,
      ['Rivers', 'Longest river?', 'Nile', 'nile', 'Amazon', '', ''],
    ]);
    expect(preview.problems[0]!.message).toContain('same as the right one');
  });

  it('warns without rejecting when an explanation is missing', () => {
    const preview = previewBank([
      header,
      ['Rivers', 'Longest river?', 'Nile', 'Amazon', '', '', ''],
    ]);
    expect(preview.questions).toHaveLength(1);
    expect(preview.warnings[0]!.message).toContain('teaches nothing');
  });

  it('warns about a repeated question', () => {
    const preview = previewBank([
      header,
      good('Rivers', 'Longest river?', 'Nile'),
      good('Rivers', 'longest RIVER?', 'Nile'),
    ]);
    expect(preview.questions).toHaveLength(2);
    expect(preview.warnings[0]!.row).toBe(3);
  });

  it('tells you which columns it ignored', () => {
    const preview = previewBank([
      [...header, 'difficulty', 'author'],
      [...good('Rivers', 'Longest river?', 'Nile'), 'hard', 'me'],
    ]);
    expect(preview.unknownColumns).toEqual(['difficulty', 'author']);
    expect(preview.questions).toHaveLength(1);
  });

  it('explains an empty file rather than showing nothing', () => {
    expect(previewBank([]).problems[0]!.message).toBe('The file is empty.');
  });

  it('points at the sample when the columns are wrong entirely', () => {
    const preview = previewBank([['a', 'b', 'c'], ['1', '2', '3']]);
    expect(preview.problems[0]!.message).toContain('Download the sample');
  });
});

describe('the campaign it builds', () => {
  const preview = previewBank([
    header,
    good('Rivers', 'Longest river?', 'Nile'),
    good('Rivers', 'Widest river?', 'Amazon'),
    good('Mountains', 'Highest mountain?', 'Everest'),
  ]);

  it('is a real campaign the rest of the game accepts', async () => {
    const campaign = await buildImportedCampaign('Geography', preview);
    expect(validateCampaign(campaign)).toEqual([]);
    expect(campaign.role).toBe('questions');
    expect(campaign.course).toBe('Geography');
  });

  it('⚠️ hashes answers the same way the shipped bank does', async () => {
    /*
     * There is nothing to protect in somebody's own file, so this looks like
     * pointless work. It is not: it means an imported question is the same
     * shape as a built one, so `checkAnswer` and `decryptExplanation` need no
     * idea where it came from and there is no second code path to keep right.
     */
    const campaign = await buildImportedCampaign('Geography', preview);
    const q = campaign.questions[0]!;
    expect(await checkAnswer(q.id, 'Nile', q.answerHash)).toBe(true);
    expect(await checkAnswer(q.id, 'Amazon', q.answerHash)).toBe(false);
  });

  it('keeps the explanation readable once the answer is known', async () => {
    const campaign = await buildImportedCampaign('Geography', preview);
    const q = campaign.questions[0]!;
    const text = await decryptExplanation(q.id, 'Nile', q.explanationCipher);
    expect(text).toBe('because that is how it is');
  });

  it('does not always put the right answer first', async () => {
    // A bank where the answer is option one every time teaches position, not
    // content. The shuffle is seeded from the question id, so it is stable.
    const campaign = await buildImportedCampaign('Geography', preview);
    const firsts = campaign.questions.map((q) => q.options?.[0]);
    expect(new Set(firsts).size).toBeGreaterThan(1);
  });

  it('imports the same file the same way twice', async () => {
    const a = await buildImportedCampaign('Geography', preview);
    const b = await buildImportedCampaign('Geography', preview);
    expect(a.questions.map((q) => q.options)).toEqual(b.questions.map((q) => q.options));
  });

  it('gives each topic its own skill, so mastery is tracked per topic', async () => {
    const campaign = await buildImportedCampaign('Geography', preview);
    expect(new Set(campaign.questions.map((q) => q.skillId)).size).toBe(2);
  });
});
