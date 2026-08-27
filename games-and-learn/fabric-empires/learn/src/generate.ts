/**
 * Asking a model for questions.
 *
 * ⚠️ **This produces a spreadsheet, not a question bank.** The output is a
 * plain grid in exactly the shape `previewBank` already reads, so generated
 * rows go through the same header check, the same per-row validation, the same
 * preview screen and the same hashing as a file somebody uploaded. There is no
 * second path into the bank, which means there is no second path that can be
 * wrong.
 *
 * ⚠️ **And it is deliberately a draft.** This is a certification study tool. A
 * confidently wrong question is worse than no question, because somebody
 * revises the wrong fact and carries it into the exam room. So nothing here
 * writes anything: it returns rows for a person to look at, and the caller
 * decides. Generated courses are also kept out of the shipped bank entirely,
 * which is checked in `campaign.ts` by them being separate campaigns.
 */

import { IMPORT_COLUMNS } from './importBank.js';

/** The most questions worth asking for in one request. */
export const MAX_GENERATED = 20;

/** What to ask for when nobody says. */
export const DEFAULT_GENERATED = 8;

/**
 * The instruction the model is given.
 *
 * ⚠️ Every line here is load-bearing and most of them are about being wrong
 * rather than about being interesting. A model asked for exam questions will
 * happily produce four defensible answers, or one answer that is correct only
 * under an assumption it did not state, and both are silently useless in a
 * multiple-choice bank.
 */
export const GENERATE_SYSTEM_PROMPT = [
  'You write multiple-choice revision questions for technical certification',
  'exams. You return JSON and nothing else.',
  '',
  'Shape:',
  '{"questions":[{"topic":"...","question":"...","answer":"...",',
  '"wrong":["...","...","..."],"explanation":"..."}]}',
  '',
  'Rules:',
  '- Exactly one answer is correct. The three wrong ones must be clearly wrong',
  '  to somebody who knows the topic, and plausible to somebody who does not.',
  '- No "all of the above", no "none of the above", no two answers that could',
  '  both be defended. If you cannot make an option unambiguously wrong,',
  '  choose a different question.',
  '- The question must stand on its own. No "in the previous question", no',
  '  reference to a diagram, no code the reader cannot see.',
  '- The explanation is one or two sentences saying why the answer is right.',
  '  It is shown only after the learner has answered.',
  '- Prefer what a practitioner has to decide over what a glossary would say.',
  '- Use the exact product names. Do not translate them.',
  '- If you do not know the subject well enough to be sure an answer is',
  '  correct, return fewer questions. Returning three good ones is a better',
  '  answer than ten you are guessing at.',
].join('\n');

/** The request, as the model sees it. */
export function generationPrompt(
  topic: string,
  count: number,
  context?: string,
): string {
  const wanted = Math.max(1, Math.min(MAX_GENERATED, Math.floor(count) || DEFAULT_GENERATED));
  const lines = [
    `Write ${wanted} multiple-choice questions about: ${topic.trim()}`,
    `Set "topic" on every question to exactly: ${topic.trim()}`,
  ];
  if (context && context.trim()) {
    // Somebody's own notes, syllabus extract or bullet list. Quoted rather
    // than summarised, because the point is that they chose it.
    lines.push('', 'Base them on this material:', context.trim().slice(0, 6000));
  }
  return lines.join('\n');
}

export interface GeneratedRow {
  readonly topic: string;
  readonly question: string;
  readonly answer: string;
  readonly wrong: readonly string[];
  readonly explanation: string;
}

/**
 * Pull the JSON out of whatever the model actually said.
 *
 * ⚠️ Models fence their JSON, apologise before it, and add a sentence after it,
 * whatever the instructions said. Parsing the first balanced object rather than
 * the whole string is the difference between a feature that works and one that
 * works most of the time.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** The rows a reply contains, ignoring anything malformed. */
export function readGeneratedRows(text: string): GeneratedRow[] {
  const parsed = extractJson(text) as { questions?: unknown } | undefined;
  const list = Array.isArray(parsed?.questions) ? parsed.questions : [];

  const rows: GeneratedRow[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const str = (key: string): string =>
      typeof item[key] === 'string' ? (item[key] as string).trim() : '';

    const wrong = Array.isArray(item.wrong)
      ? item.wrong.map((w) => (typeof w === 'string' ? w.trim() : '')).filter(Boolean)
      : [];

    const row = {
      topic: str('topic'),
      question: str('question'),
      answer: str('answer'),
      wrong,
      explanation: str('explanation'),
    };
    // Anything without the three fields the importer requires is not a row.
    // `previewBank` would reject it with a message about a spreadsheet the
    // author never saw, which would be a confusing way to say "the model
    // returned rubbish".
    if (!row.topic || !row.question || !row.answer) continue;
    rows.push(row);
  }
  return rows;
}

/**
 * The rows as a grid, header included, ready for `previewBank`.
 *
 * This is the whole reason the generated path has no validation of its own.
 */
export function rowsToGrid(rows: readonly GeneratedRow[]): string[][] {
  return [
    [...IMPORT_COLUMNS],
    ...rows.map((row) => [
      row.topic,
      row.question,
      row.answer,
      row.wrong[0] ?? '',
      row.wrong[1] ?? '',
      row.wrong[2] ?? '',
      row.explanation,
    ]),
  ];
}

/**
 * A file name for a topic that is safe to write to disk.
 *
 * ⚠️ The topic comes from whoever is typing, and it ends up as a path on the
 * host. Anything outside this alphabet is dropped rather than escaped: there
 * is no legitimate topic that needs a slash in it, and "reject what is not
 * obviously safe" is the only version of this that is easy to be sure about.
 */
export function bankSlug(topic: string): string {
  const slug = topic
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'topic';
}
