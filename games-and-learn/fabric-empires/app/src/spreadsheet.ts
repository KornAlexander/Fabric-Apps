/**
 * Spreadsheets in and out.
 *
 * The only part of the import that knows what a file is. Everything about what
 * a row MEANS lives in `learn/importBank.ts`, which takes a plain grid, so the
 * meaning is testable without a browser and this module stays a thin adapter
 * over two readers and one writer.
 *
 * ## Why `.xlsx` at all
 *
 * Measured before committing to it: `read-excel-file` plus `write-excel-file`
 * cost **145 KB raw, 43 KB gzipped**, on a bundle that was 383 KB gzipped.
 * That is a real 13 percent, paid because "bring your own questions" is what
 * turns this from a DP-600 study aid into a study aid that ships with DP-600
 * in it, and because a customisation feature that only accepts a format people
 * cannot easily produce is not customisation.
 *
 * ⚠️ **`xlsx` (SheetJS) was ruled out on security grounds.** Its npm package is
 * frozen at 0.18.5 because the maintainers moved distribution to their own CDN,
 * and that version carries CVE-2023-30533, a prototype pollution flaw. Not
 * something to put in a repository that is about to be made public.
 *
 * CSV is accepted too, so a phone, Google Sheets, Numbers or a text editor can
 * produce a course.
 */

import readXlsxFile from 'read-excel-file/browser';
import writeXlsxFile from 'write-excel-file/browser';
import { sampleGrid, IMPORT_COLUMNS } from '@fabric-empires/learn';

/** Every cell of a sheet, as text. */
export type Grid = readonly (readonly string[])[];

/**
 * Split one line of CSV.
 *
 * ⚠️ Hand-written because a question bank is exactly the content that breaks a
 * naive `split(',')`: explanations contain commas, and an answer may contain a
 * quoted phrase. Doubled quotes inside a quoted field are the escape, which is
 * what Excel writes.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',' || ch === ';') {
      // ⚠️ Semicolons too. A German Excel writes CSV with semicolons, because
      // the comma is the decimal separator in that locale, and a file that
      // opens perfectly on the machine it was made on arrives here as one
      // enormous single column.
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

function parseCsv(text: string): Grid {
  // Strip a byte order mark: Excel writes one and it would otherwise become
  // part of the first column's name, so "topic" would not match "\uFEFFtopic".
  const clean = text.replace(/^\uFEFF/, '');
  return clean
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map(splitCsvLine);
}

/** Read a dropped or chosen file into a grid, whatever format it is. */
export async function readGrid(file: File): Promise<Grid> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') {
    return parseCsv(await file.text());
  }

  /*
   * ⚠️ The reader has two shapes and which one you get depends on the options.
   * With no options it resolves to the rows of the first sheet; with
   * `getSheets` or a sheet name it resolves to `{ sheet, data }[]`. Handling
   * both is three lines and means a workbook with several tabs does not fail
   * with a type error dressed up as "that file could not be read".
   */
  const result = (await readXlsxFile(file)) as unknown;
  const rows = Array.isArray(result) && result.length > 0 && isSheet(result[0])
    ? (result[0] as { data: unknown[][] }).data
    : (result as unknown[][]);

  return rows.map((row) =>
    (row ?? []).map((c) => (c === null || c === undefined ? '' : String(c))),
  );
}

function isSheet(value: unknown): value is { sheet: string; data: unknown[][] } {
  return typeof value === 'object' && value !== null && 'data' in value && 'sheet' in value;
}

/**
 * Save a blob under a name, by clicking a link nobody sees.
 *
 * ⚠️ **Done here rather than left to the library.** `write-excel-file` will
 * save the file itself if given a `fileName`, and measured in a real browser
 * that produced no download and threw nothing: the promise simply resolved and
 * nothing happened. Asking it for the bytes and doing the save explicitly is
 * three lines, works, and can be seen to work.
 */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick: revoking immediately can cancel the download in
  // some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Write the sample workbook.
 *
 * Column widths are set because the default is narrow enough that an
 * explanation shows as `####`, and the first impression of the template would
 * be that it is broken.
 */
export async function downloadSample(fileName = 'fabric-empires-questions.xlsx'): Promise<void> {
  const grid = sampleGrid();
  const [header, ...body] = grid;

  const sheet = [
    (header ?? [...IMPORT_COLUMNS]).map((value) => ({ value, fontWeight: 'bold' })),
    ...body.map((row) => row.map((value) => ({ value }))),
  ];

  /*
   * ⚠️ **Version 4 changed this API and the old shape fails silently.**
   * Version 3 took `fileName` in the options and saved the file itself.
   * Version 4 ignores that and returns `{ toBlob, toFile }` instead, so the
   * old call resolved, returned an object that is not a Blob, and downloaded
   * nothing without throwing anything a `catch` could report. It cost a long
   * hunt: the button was clicked, the handler ran, the promise resolved and
   * the browser did nothing at all.
   */
  const write = writeXlsxFile as unknown as (
    rows: unknown,
    options: unknown,
  ) => { toBlob: () => Promise<Blob> };

  const blob = await write(sheet, {
    columns: [
      { width: 20 }, // topic
      { width: 52 }, // question
      { width: 22 }, // answer
      { width: 18 },
      { width: 18 },
      { width: 18 },
      { width: 60 }, // explanation
    ],
  }).toBlob();

  saveBlob(blob, fileName);
}
