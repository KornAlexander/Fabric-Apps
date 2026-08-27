/**
 * Asking a model for questions.
 *
 * ⚠️ **Two things are worth testing here and neither is the prompt.** A prompt
 * cannot be unit tested and a model's answer cannot be predicted. What can be
 * checked is the part that turns whatever came back into rows, which has to
 * cope with a model that fences its JSON and apologises before it, and the
 * part that turns a topic somebody typed into a path on a server, which is the
 * only place in this feature where being wrong is dangerous rather than
 * disappointing.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GENERATED,
  GENERATE_SYSTEM_PROMPT,
  IMPORT_COLUMNS,
  MAX_GENERATED,
  bankSlug,
  extractJson,
  generationPrompt,
  previewBank,
  readGeneratedRows,
  rowsToGrid,
} from '../src/index.js';

const oneQuestion = {
  questions: [
    {
      topic: 'Delta maintenance',
      question: 'Which command rewrites small files in a Delta table?',
      answer: 'OPTIMIZE',
      wrong: ['VACUUM', 'REFRESH', 'ANALYZE'],
      explanation: 'OPTIMIZE compacts small files; VACUUM removes unreferenced ones.',
    },
  ],
};

describe('reading what the model said', () => {
  it('reads a plain JSON reply', () => {
    const rows = readGeneratedRows(JSON.stringify(oneQuestion));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.answer).toBe('OPTIMIZE');
  });

  it('⚠️ reads it out of a fenced code block', () => {
    // Models fence their JSON whatever the instructions said.
    const reply = '```json\n' + JSON.stringify(oneQuestion) + '\n```';
    expect(readGeneratedRows(reply)).toHaveLength(1);
  });

  it('⚠️ reads it with an apology in front and a remark after', () => {
    const reply = `Certainly! Here are the questions:\n\n${JSON.stringify(oneQuestion)}\n\nLet me know if you would like more.`;
    expect(readGeneratedRows(reply)).toHaveLength(1);
  });

  it('returns nothing for a reply with no JSON in it, rather than throwing', () => {
    expect(readGeneratedRows('I am not able to help with that.')).toEqual([]);
    expect(readGeneratedRows('')).toEqual([]);
    expect(extractJson('nothing here')).toBeUndefined();
  });

  it('survives malformed JSON', () => {
    expect(readGeneratedRows('{"questions": [')).toEqual([]);
  });

  it('⚠️ drops rows missing what the importer requires, keeping the rest', () => {
    /*
     * A half-written row would otherwise reach `previewBank` and be reported
     * against a spreadsheet row number the author never saw, which is a
     * confusing way to say "the model returned rubbish".
     */
    const mixed = {
      questions: [
        { topic: 'A', question: 'Q1?', answer: 'yes', wrong: ['no'], explanation: '' },
        { topic: 'A', question: '', answer: 'yes' },
        { topic: '', question: 'Q3?', answer: 'yes' },
        { topic: 'A', question: 'Q4?' },
        'not an object',
      ],
    };
    const rows = readGeneratedRows(JSON.stringify(mixed));
    expect(rows.map((r) => r.question)).toEqual(['Q1?']);
  });

  it('ignores non-string distractors instead of printing undefined', () => {
    const odd = {
      questions: [{ topic: 'A', question: 'Q?', answer: 'a', wrong: ['b', 7, null, 'c'] }],
    };
    expect(readGeneratedRows(JSON.stringify(odd))[0]!.wrong).toEqual(['b', 'c']);
  });
});

describe('⚠️ the grid is the same grid a spreadsheet produces', () => {
  /*
   * The whole design. Generated rows go through the importer's own header
   * check, per-row validation, preview and hashing, so there is no second path
   * into the question bank that could be wrong in its own way.
   */
  it('writes the importer\'s own header', () => {
    expect(rowsToGrid([])[0]).toEqual([...IMPORT_COLUMNS]);
  });

  it('is accepted by previewBank with no special handling', () => {
    const grid = rowsToGrid(readGeneratedRows(JSON.stringify(oneQuestion)));
    const preview = previewBank(grid);
    expect(preview.problems).toEqual([]);
    expect(preview.questions).toHaveLength(1);
    expect(preview.topics).toEqual(['Delta maintenance']);
  });

  it('pads missing distractors rather than shifting the columns', () => {
    const rows = readGeneratedRows(
      JSON.stringify({ questions: [{ topic: 'A', question: 'Q?', answer: 'a', wrong: ['b'] }] }),
    );
    const row = rowsToGrid(rows)[1]!;
    expect(row).toHaveLength(IMPORT_COLUMNS.length);
    expect(row[3]).toBe('b');
    expect(row[4]).toBe('');
    expect(row[6]).toBe('');
  });
});

describe('the request', () => {
  it('names the topic and pins it onto every row', () => {
    const prompt = generationPrompt('Direct Lake', 5);
    expect(prompt).toContain('Direct Lake');
    expect(prompt).toContain('5');
  });

  it('clamps the count to something a model can do well', () => {
    expect(generationPrompt('x', 500)).toContain(String(MAX_GENERATED));
    expect(generationPrompt('x', 0)).toContain(String(DEFAULT_GENERATED));
    expect(generationPrompt('x', -3)).toContain('1');
  });

  it('includes supplied material, bounded', () => {
    const long = 'a'.repeat(9000);
    expect(generationPrompt('x', 3, long).length).toBeLessThan(7000);
    expect(generationPrompt('x', 3, 'my notes')).toContain('my notes');
  });

  it('⚠️ tells the model to return fewer rather than guess', () => {
    /*
     * The single most important line in the prompt. This is a certification
     * study tool: a confidently wrong question is worse than no question,
     * because somebody revises the wrong fact and takes it into the exam.
     */
    expect(GENERATE_SYSTEM_PROMPT).toContain('return fewer questions');
    expect(GENERATE_SYSTEM_PROMPT).toContain('Exactly one answer is correct');
    expect(GENERATE_SYSTEM_PROMPT).toContain('all of the above');
  });
});

describe('⚠️ the topic becomes a file name on somebody\'s host', () => {
  /*
   * The only genuinely dangerous part of this feature. The topic is typed by
   * whoever is playing and ends up as a path on the machine running the game.
   */
  it('cannot climb out of the bank directory', () => {
    expect(bankSlug('../../etc/passwd')).not.toContain('..');
    expect(bankSlug('../../etc/passwd')).not.toContain('/');
    expect(bankSlug('..\\..\\windows\\system32')).not.toContain('\\');
    expect(bankSlug('/absolute/path')).not.toContain('/');
  });

  it('drops anything that is not a plain letter or digit', () => {
    expect(bankSlug('Delta Lake: table maintenance!')).toBe('delta-lake-table-maintenance');
    expect(bankSlug('C:\\nul')).toBe('c-nul');
  });

  it('folds accents rather than emitting them', () => {
    expect(bankSlug('Fabrik Übersicht')).toBe('fabrik-ubersicht');
  });

  it('always returns something usable', () => {
    // A topic of pure punctuation must not produce an empty file name.
    expect(bankSlug('***')).toBe('topic');
    expect(bankSlug('')).toBe('topic');
    expect(bankSlug('   ')).toBe('topic');
  });

  it('stays a sensible length', () => {
    expect(bankSlug('x'.repeat(400)).length).toBeLessThanOrEqual(60);
  });
});
