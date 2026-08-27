/**
 * The capacity edition, in one file.
 *
 * Serves the built game AND the `api/coach` route the connected edition looks
 * for. Run this and you have the Fabric-capacity flavour; serve `app/dist`
 * from anything else and you have the standalone one. Same bundle either way,
 * which is the point: there is one game and two ways to host it.
 *
 * ## ⚠️ Why this exists at all
 *
 * A static page cannot hold a secret. The browser never sees the Foundry key;
 * it POSTs a question and a progress digest to this process, and this process
 * holds the credential. That is the entire reason for the hop.
 *
 * ## Running it
 *
 *   npm run build
 *   set AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
 *   set AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
 *   set AZURE_OPENAI_KEY=<key>            # or use a managed identity, below
 *   node tools/coach/server.mjs
 *
 * With no endpoint configured it still runs and still serves the game: the
 * probe answers `{ coach: false }` and the app quietly stays in its standalone
 * shape. That is deliberate, so a misconfigured deployment degrades to the
 * working game rather than to an error.
 *
 * ⚠️ **A key in an environment variable is the second-best answer.** On Fabric
 * or Azure the better one is a managed identity: set `AZURE_OPENAI_TOKEN` from
 * `az account get-access-token --resource https://cognitiveservices.azure.com`
 * and no key exists anywhere. The code below prefers the token when both are
 * present.
 */

import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 5183);
const ROOT = resolve(process.cwd(), 'app/dist');

/**
 * Where generated questions are kept.
 *
 * ⚠️ **A directory of JSON files is the database, and that is a decision
 * rather than a shortcut.** The alternative that keeps being suggested is a
 * Fabric Lakehouse table, which for this project would be thematically
 * perfect and practically wrong: it needs a workspace, a table and a second
 * set of credentials, and it would make the reference host unrunnable for
 * anyone without a capacity. This runs anywhere Node runs, survives a
 * restart, and is shared by every browser pointed at the host, which is the
 * whole of what "saved to a database" has to mean here.
 *
 * Overridable, because the one thing a container needs is for this to be on a
 * mounted volume rather than inside the image.
 */
const BANK_DIR = resolve(process.env.FE_BANK_DIR ?? 'tools/coach/banks');

const ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT ?? '').replace(/\/+$/, '');
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT ?? '';
const API_VERSION = process.env.AZURE_OPENAI_API_VERSION ?? '2024-10-21';
const KEY = process.env.AZURE_OPENAI_KEY ?? '';
const TOKEN = process.env.AZURE_OPENAI_TOKEN ?? '';

const configured = Boolean(ENDPOINT && DEPLOYMENT && (KEY || TOKEN));

/**
 * Kept in step with `learn/src/coach.ts` by hand.
 *
 * ⚠️ Deliberately duplicated rather than imported. This process must be able to
 * run against a built `dist` with no workspace around it, and a server that
 * cannot start because a TypeScript package moved is a worse failure than a
 * prompt that has to be copied when it changes.
 */
const SYSTEM_PROMPT = [
  'You are a study coach for the Microsoft DP-600 exam, inside a strategy game',
  'where the exam outline is the tech tree.',
  '',
  "You are given a factual digest of the learner's spaced-repetition data,",
  'including a ranking of what is most valuable to study next. That ranking is',
  'already weighted by the published exam weighting and by how far each topic',
  'has decayed.',
  '',
  'Rules:',
  '- Answer from the digest. Do not invent topics, numbers or progress.',
  '- If the digest does not contain the answer, say so plainly.',
  '- Keep the given ranking. You may explain it, group it or reorder within',
  '  ties, but do not substitute a different opinion about priorities.',
  '- Be brief and concrete. Two or three sentences unless asked for more.',
  '- Never claim the learner is ready to sit the exam. Report the number and',
  '  let them decide.',
  '- Answer in the language the learner writes in.',
].join('\n');

/**
 * The question-writing instruction.
 *
 * ⚠️ Kept in step with `learn/src/generate.ts` by hand, for the same reason
 * the coach prompt is: this process must run against a built `dist` with no
 * workspace around it.
 *
 * Every line is about being wrong rather than being interesting. A model asked
 * for exam questions will happily produce four defensible answers, or one that
 * is correct only under an assumption it did not state.
 */
const GENERATE_PROMPT = [
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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

const json = (res, code, body) => {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
};

/** Read a JSON body, with a cap. A coach question is small; anything else is not a question. */
async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function askFoundry(question, digest, history) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `Learner progress digest:\n\n${digest}` },
    ...history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .slice(-6)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) })),
    { role: 'user', content: question },
  ];

  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;
  const headers = { 'content-type': 'application/json' };
  // A managed-identity token is preferred; a key is the fallback.
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  else headers['api-key'] = KEY;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages, temperature: 0.2, max_tokens: 400 }),
  });

  if (!response.ok) {
    // ⚠️ The upstream body may name the resource or quote the request. Logged
    // for whoever runs this, never returned to the browser.
    console.error('Foundry rejected the request', response.status, await response.text());
    throw new Error(`upstream ${response.status}`);
  }

  const body = await response.json();
  return body?.choices?.[0]?.message?.content?.trim() ?? '';
}

/**
 * Ask for questions on a topic.
 *
 * Warmer than the coach at 0.5: identical questions every time would be a
 * worse feature than slightly uneven ones, and unlike the coach there is no
 * digest of facts to stay faithful to.
 */
async function generateFoundry(topic, count, context) {
  const wanted = Math.max(1, Math.min(20, Number(count) || 8));
  const ask = [
    `Write ${wanted} multiple-choice questions about: ${topic}`,
    `Set "topic" on every question to exactly: ${topic}`,
  ];
  if (context) ask.push('', 'Base them on this material:', String(context).slice(0, 6000));

  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;
  const headers = { 'content-type': 'application/json' };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  else headers['api-key'] = KEY;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messages: [
        { role: 'system', content: GENERATE_PROMPT },
        { role: 'user', content: ask.join('\n') },
      ],
      temperature: 0.5,
      max_tokens: 2400,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    console.error('Foundry rejected the request', response.status, await response.text());
    throw new Error(`upstream ${response.status}`);
  }
  const body = await response.json();
  return body?.choices?.[0]?.message?.content?.trim() ?? '';
}

/**
 * A file name for a topic that is safe to write.
 *
 * ⚠️ The topic is typed by whoever is using the game and ends up as a path on
 * this host. Anything outside this alphabet is dropped rather than escaped:
 * no legitimate topic needs a slash in it, and "reject what is not obviously
 * safe" is the only version of this that is easy to be sure about.
 */
function bankSlug(topic) {
  const slug = String(topic ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'topic';
}

/** Every bank saved on this host, newest first. */
function listBanks() {
  if (!existsSync(BANK_DIR)) return [];
  const out = [];
  for (const name of readdirSync(BANK_DIR)) {
    if (!name.endsWith('.json')) continue;
    try {
      const bank = JSON.parse(readFileSync(join(BANK_DIR, name), 'utf8'));
      out.push({
        slug: name.replace(/\.json$/, ''),
        topic: bank.topic ?? '',
        count: Array.isArray(bank.rows) ? bank.rows.length : 0,
        savedAt: bank.savedAt ?? '',
      });
    } catch {
      // One unreadable file should not hide the rest of the shelf.
    }
  }
  return out.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const wanted = url.pathname === '/' ? '/index.html' : url.pathname;
  // ⚠️ Normalised and prefix-checked, so `..` cannot walk out of dist.
  const path = join(ROOT, normalize(wanted).replace(/^(\.\.[/\\])+/, ''));
  if (!path.startsWith(ROOT) || !existsSync(path) || !statSync(path).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/coach') {
    if (req.method === 'GET') {
      // The probe. `coach: false` is a real answer, not a failure: it tells the
      // app to stay standalone rather than to show a chat that cannot work.
      json(res, 200, { coach: configured });
      return;
    }
    if (req.method === 'POST') {
      if (!configured) {
        json(res, 503, { error: 'No model configured' });
        return;
      }
      void (async () => {
        try {
          const body = await readBody(req);
          const question = String(body.question ?? '').slice(0, 2000);
          const digest = String(body.digest ?? '').slice(0, 20_000);
          if (!question) {
            json(res, 400, { error: 'No question' });
            return;
          }
          const reply = await askFoundry(question, digest, body.history ?? []);
          json(res, 200, { reply });
        } catch (error) {
          console.error('Coach failed', error);
          json(res, 502, { error: 'The coach could not answer' });
        }
      })();
      return;
    }
    res.writeHead(405).end();
    return;
  }

  /*
   * Writing questions for a topic that is not in any outline.
   *
   * ⚠️ This returns rows and saves nothing. The browser puts them through the
   * same preview a spreadsheet upload goes through, and a person decides. A
   * study tool that quietly filled its own question bank with generated
   * material would be teaching whatever the model happened to believe.
   */
  if (url.pathname === '/api/questions' && req.method === 'POST') {
    if (!configured) {
      json(res, 503, { error: 'No model configured' });
      return;
    }
    void (async () => {
      try {
        const body = await readBody(req);
        const topic = String(body.topic ?? '').trim().slice(0, 200);
        if (!topic) {
          json(res, 400, { error: 'No topic' });
          return;
        }
        const reply = await generateFoundry(topic, body.count, body.context);
        json(res, 200, { reply });
      } catch (error) {
        console.error('Question generation failed', error);
        json(res, 502, { error: 'The model could not write questions' });
      }
    })();
    return;
  }

  /*
   * The bank: what has been kept, and keeping it.
   *
   * GET doubles as the probe. It answers on an unconfigured host too, because
   * saved questions are still readable when no model is available: writing
   * needs Foundry, reading does not.
   */
  if (url.pathname === '/api/bank') {
    if (req.method === 'GET') {
      json(res, 200, { bank: true, banks: listBanks() });
      return;
    }
    if (req.method === 'POST') {
      void (async () => {
        try {
          // Larger than a coach question: a bank of twenty questions with
          // explanations is a few tens of kilobytes.
          const body = await readBody(req, 512 * 1024);
          const topic = String(body.topic ?? '').trim().slice(0, 200);
          const rows = Array.isArray(body.rows) ? body.rows : [];
          if (!topic || rows.length === 0) {
            json(res, 400, { error: 'A topic and at least one row are needed' });
            return;
          }
          mkdirSync(BANK_DIR, { recursive: true });
          const slug = bankSlug(topic);
          const file = join(BANK_DIR, `${slug}.json`);
          // ⚠️ Belt and braces on the path. `bankSlug` cannot produce a
          // separator, and this checks anyway, because the cost of being
          // wrong here is writing wherever the caller likes.
          if (!file.startsWith(BANK_DIR)) {
            json(res, 400, { error: 'Bad topic' });
            return;
          }
          writeFileSync(
            file,
            JSON.stringify(
              {
                topic,
                slug,
                // Stated in the file itself, so nobody finding it later has to
                // wonder where the questions came from.
                source: 'generated',
                model: DEPLOYMENT,
                savedAt: new Date().toISOString(),
                rows,
              },
              null,
              2,
            ),
            'utf8',
          );
          console.log(`Saved ${rows.length} question(s) for "${topic}" to ${file}`);
          json(res, 200, { slug, saved: rows.length });
        } catch (error) {
          console.error('Saving the bank failed', error);
          json(res, 502, { error: 'The bank could not be saved' });
        }
      })();
      return;
    }
    res.writeHead(405).end();
    return;
  }

  /** One saved bank, by slug, so a second browser can play what a first wrote. */
  if (url.pathname.startsWith('/api/bank/') && req.method === 'GET') {
    const slug = bankSlug(url.pathname.slice('/api/bank/'.length));
    const file = join(BANK_DIR, `${slug}.json`);
    if (!file.startsWith(BANK_DIR) || !existsSync(file)) {
      json(res, 404, { error: 'No such bank' });
      return;
    }
    try {
      json(res, 200, JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      json(res, 500, { error: 'That bank could not be read' });
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Fabric Empires, capacity edition, on http://localhost:${PORT}`);
  console.log(`  serving ${ROOT}`);
  console.log(
    configured
      ? `  coach: ${DEPLOYMENT} at ${ENDPOINT} (${TOKEN ? 'managed identity' : 'key'})`
      : '  coach: not configured, the game runs in its standalone shape',
  );
  console.log(`  bank:  ${BANK_DIR} (${listBanks().length} saved)`);
});
