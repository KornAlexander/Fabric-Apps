/**
 * Build the shipped question banks from the plaintext authoring sources.
 *
 *   node tools/content/build-questions.mjs [--check]
 *
 * Walks every campaign under learn/content, reads `questions/src/*.json`,
 * replaces each item's `answer` and `explanation` with a hash and a
 * ciphertext, and writes the result to `questions/`. With --check it verifies
 * the built files are up to date instead of writing, which is what CI runs.
 *
 * The crypto lives in learn/src/crypto.ts and is shared with the runtime, so
 * a bank is always built by exactly the code that reads it.
 *
 * ⚠️ Every campaign shares one salt. It is not a secret and never was: the
 * point of hashing here is that a shipped bundle contains no readable answer
 * key, not that anybody could not derive one. Per-campaign salts would mean
 * the runtime had to know which campaign a question came from before it could
 * check it, for no gain.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CONTENT = path.join(ROOT, 'learn', 'content');

const ANSWER_SALT = 'fabric-empires:dp600:v1';
const PBKDF2_ITERATIONS = 100_000;
const IV_BYTES = 12;

function normaliseAnswer(answer) {
  const parts = (Array.isArray(answer) ? answer : [answer])
    .map((part) => String(part).trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((part) => part.length > 0)
    .sort();
  return parts.join('|');
}

/**
 * Deterministically permute a question's options.
 *
 * ⚠️ Authoring naturally puts the correct answer first, and it is invisible in
 * any single question. Measured across the first three clusters, the answer was
 * option one in 54 of 54 items: a player would have learned to click the first
 * option and scored full marks knowing nothing at all.
 *
 * Shuffling here rather than at render time keeps the shipped file the single
 * source of truth, and seeding from the question id keeps builds reproducible.
 * It is safe because answers are hashed by TEXT, never by position.
 */
function seededShuffle(items, seedText) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

async function hashAnswer(questionId, answer) {
  const payload = `${ANSWER_SALT}|${questionId}|${normaliseAnswer(answer)}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function deriveKey(questionId, answer) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${normaliseAnswer(answer)}|${questionId}`),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(ANSWER_SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptExplanation(questionId, answer, explanation) {
  const key = await deriveKey(questionId, answer);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(explanation),
  );
  const packed = new Uint8Array(iv.length + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertext), iv.length);
  return Buffer.from(packed).toString('base64');
}

async function buildFile(dirs, name, check) {
  const source = JSON.parse(await readFile(path.join(dirs.src, name), 'utf8'));
  const outPath = path.join(dirs.out, name);

  const existing =
    existsSync(outPath) ? JSON.parse(await readFile(outPath, 'utf8')) : undefined;
  const existingById = new Map(
    (existing?.questions ?? []).map((q) => [q.id, q]),
  );

  const questions = [];
  for (const draft of source.questions) {
    const { answer, explanation, ...rest } = draft;
    if (answer === undefined || explanation === undefined) {
      throw new Error(`${draft.id}: authoring source needs answer and explanation`);
    }

    const answerHash = await hashAnswer(draft.id, answer);
    const previous = existingById.get(draft.id);

    // Reuse the existing ciphertext when the answer and explanation are
    // unchanged. AES-GCM uses a fresh random IV every time, so rebuilding
    // unconditionally would rewrite every line of every file on every run and
    // make the diff useless for review.
    let explanationCipher;
    if (previous && previous.answerHash === answerHash) {
      const stillMatches = await decryptMatches(
        draft.id,
        answer,
        previous.explanationCipher,
        explanation,
      );
      explanationCipher = stillMatches
        ? previous.explanationCipher
        : await encryptExplanation(draft.id, answer, explanation);
    } else {
      explanationCipher = await encryptExplanation(draft.id, answer, explanation);
    }

    questions.push({
      ...rest,
      ...(rest.options ? { options: seededShuffle(rest.options, draft.id) } : {}),
      answerHash,
      explanationCipher,
    });
  }

  const built = {
    cluster: source.cluster,
    generated: 'tools/content/build-questions.mjs',
    questions,
  };
  const text = `${JSON.stringify(built, null, 2)}\n`;

  if (check) {
    const current = existsSync(outPath) ? await readFile(outPath, 'utf8') : '';
    return { name, upToDate: current === text, count: questions.length };
  }

  await writeFile(outPath, text, 'utf8');
  return { name, upToDate: true, count: questions.length };
}

async function decryptMatches(questionId, answer, cipher, expected) {
  try {
    const packed = Buffer.from(cipher, 'base64');
    const iv = packed.subarray(0, IV_BYTES);
    const ciphertext = packed.subarray(IV_BYTES);
    const key = await deriveKey(questionId, answer);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plain) === expected;
  } catch {
    return false;
  }
}

const check = process.argv.includes('--check');

/** Every campaign folder that has an authoring source directory. */
async function campaigns() {
  const out = [];
  for (const entry of (await readdir(CONTENT, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory()) continue;
    const src = path.join(CONTENT, entry.name, 'questions', 'src');
    if (!existsSync(src)) continue;
    out.push({ id: entry.name, src, out: path.join(CONTENT, entry.name, 'questions') });
  }
  return out;
}

let failed = false;
for (const campaign of await campaigns()) {
  const files = (await readdir(campaign.src)).filter((f) => f.endsWith('.json')).sort();
  for (const name of files) {
    const result = await buildFile(campaign, name, check);
    const label = `${campaign.id}/${name}`;
    if (check && !result.upToDate) {
      console.error(`STALE  ${label} (run: node tools/content/build-questions.mjs)`);
      failed = true;
    } else {
      console.log(`${check ? 'ok    ' : 'built '} ${label}  ${result.count} questions`);
    }
  }
}

process.exit(failed ? 1 : 0);
