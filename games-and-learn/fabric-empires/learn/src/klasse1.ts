/**
 * The Klasse 1 question bank.
 *
 * ⚠️ **This campaign supplies questions, not a world.** It has 24 skills, and
 * `minimumTopicCount()` is 41, so it could never unlock the late units. That is
 * not a defect: in two-player co-op the empire is built from player one's
 * course and player two answers alongside them at their own level. A six-year-
 * old is playing the parent's game, not running an empire of their own.
 *
 * The stems are deliberately tiny (D216). A first grader is still learning to
 * read, under a clock, so anything needing a sentence parsed is not a Year 1
 * question however good the pedagogy.
 */

import type { Question } from './questions.js';
import m1 from '../content/klasse-1/questions/M1.json' with { type: 'json' };
import m2 from '../content/klasse-1/questions/M2.json' with { type: 'json' };
import m3 from '../content/klasse-1/questions/M3.json' with { type: 'json' };
import d1 from '../content/klasse-1/questions/D1.json' with { type: 'json' };
import d2 from '../content/klasse-1/questions/D2.json' with { type: 'json' };
import d3 from '../content/klasse-1/questions/D3.json' with { type: 'json' };
import d4 from '../content/klasse-1/questions/D4.json' with { type: 'json' };
import outlineJson from '../content/klasse-1/outline.json' with { type: 'json' };
import type { Outline } from './outline.js';

interface BankFile {
  readonly cluster: string;
  readonly questions: readonly Question[];
}

const FILES: readonly BankFile[] = [
  m1 as unknown as BankFile,
  m2 as unknown as BankFile,
  m3 as unknown as BankFile,
  d1 as unknown as BankFile,
  d2 as unknown as BankFile,
  d3 as unknown as BankFile,
  d4 as unknown as BankFile,
];

export const KLASSE1_OUTLINE: Outline = outlineJson as Outline;

export const KLASSE1_QUESTIONS: readonly Question[] = FILES.flatMap(
  (file) => file.questions,
);
