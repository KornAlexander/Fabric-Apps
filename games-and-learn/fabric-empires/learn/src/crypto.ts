/**
 * Answer obfuscation.
 *
 * Two layers, and it is worth being precise about what they achieve:
 *
 * 1. The answer is stored as a SHA-256 hash, so the shipped bundle does not
 *    contain a readable answer key.
 * 2. The explanation is AES-GCM encrypted under a key derived from the answer,
 *    so explanations cannot be mined for answers either.
 *
 * ⚠️ This is OBFUSCATION, NOT SECURITY. For a four-option question an attacker
 * can try all four candidates locally in milliseconds. It stops "view source,
 * read the JSON", which is the realistic threat for a study game, and nothing
 * stronger is possible: the Fabric App shell is anonymous, so everything the
 * client needs is by definition in the client.
 *
 * Uses WebCrypto, which is identical in the browser and in Node, so the same
 * code both builds the bank and reads it.
 */

/** Public, and deliberately so: it is in the shipped bundle either way. */
export const ANSWER_SALT = 'fabric-empires:dp600:v1';

const PBKDF2_ITERATIONS = 100_000;
const IV_BYTES = 12;

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error('WebCrypto is unavailable; a modern runtime is required');
  }
  return c.subtle;
}

/**
 * Canonical form of an answer.
 *
 * Case, surrounding space and the order of a multi-select are all irrelevant
 * to correctness, so they must be irrelevant to the hash too. Otherwise a
 * player who picks the right two options in the wrong order is told they are
 * wrong, which is the worst possible bug in a teaching tool.
 */
export function normaliseAnswer(answer: string | readonly string[]): string {
  const parts = (Array.isArray(answer) ? answer : [answer as string])
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((part) => part.length > 0)
    .sort();
  return parts.join('|');
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function hashAnswer(
  questionId: string,
  answer: string | readonly string[],
): Promise<string> {
  const payload = `${ANSWER_SALT}|${questionId}|${normaliseAnswer(answer)}`;
  const digest = await subtle().digest('SHA-256', new TextEncoder().encode(payload));
  return toHex(digest);
}

export async function checkAnswer(
  questionId: string,
  answer: string | readonly string[],
  expectedHash: string,
): Promise<boolean> {
  return (await hashAnswer(questionId, answer)) === expectedHash;
}

async function deriveKey(
  questionId: string,
  answer: string | readonly string[],
): Promise<CryptoKey> {
  const material = await subtle().importKey(
    'raw',
    new TextEncoder().encode(`${normaliseAnswer(answer)}|${questionId}`),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
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

export async function encryptExplanation(
  questionId: string,
  answer: string | readonly string[],
  explanation: string,
): Promise<string> {
  const key = await deriveKey(questionId, answer);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await subtle().encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(explanation),
  );

  const packed = new Uint8Array(iv.length + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertext), iv.length);
  return toBase64(packed);
}

/**
 * Decrypt an explanation. Returns undefined for a wrong answer rather than
 * throwing, because a wrong answer is a normal event, not an error.
 */
export async function decryptExplanation(
  questionId: string,
  answer: string | readonly string[],
  cipher: string,
): Promise<string | undefined> {
  try {
    const packed = fromBase64(cipher);
    const iv = packed.slice(0, IV_BYTES);
    const ciphertext = packed.slice(IV_BYTES);
    const key = await deriveKey(questionId, answer);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plain);
  } catch {
    return undefined;
  }
}
