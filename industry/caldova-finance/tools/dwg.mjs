// Run Michael Tenner's dwg cli (https://github.com/Losveratos/dwg-cli, MIT) from this template's folder, so every
// path in the commands is relative to the template: `npm run dwg -- <command> …`.
//
// The checkout is found in DWG_CLI, else next to this template (../dwg-cli). Set it up once:
//   git clone https://github.com/Losveratos/dwg-cli ../dwg-cli
//   node ../dwg-cli/install.mjs
//
//   npm run dwg -- templates --lang en
//   npm run dwg -- templates T05B --lang en
//   npm run dwg:check                      (check + lint of dwg/caldova-finance.json against the model)
//   npm run dwg -- --pages                 (regenerates src/dwg and src/vendor from the spec, then patches them to English)
//   npm run dwg -- --where                (prints the checkout's folder, for paths like <dwg-cli>/visuals/...)
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = 'dwg/caldova-finance.json';
const MODEL = 'fabric/caldova-finance.SemanticModel';

function dwgCheckout() {
  const candidates = [process.env.DWG_CLI, resolve(ROOT, '../dwg-cli')].filter(Boolean);
  const dir = candidates.find((d) => existsSync(resolve(d, 'dwg.mjs')));
  if (!dir) {
    console.error(
      'dwg cli not found. Clone it next to this template or point DWG_CLI at a checkout:\n' +
        '  git clone https://github.com/Losveratos/dwg-cli ../dwg-cli\n  node ../dwg-cli/install.mjs\n' +
        `Looked in: ${candidates.join(', ')}`,
    );
    process.exit(2);
  }
  return dir;
}

const run = (dir, args) => spawnSync(process.execPath, [resolve(dir, 'dwg.mjs'), ...args], { cwd: ROOT, stdio: 'inherit' }).status ?? 1;

// Run unconditionally: nothing imports this file, and comparing argv[1] with import.meta.url fails on Windows when
// the drive letter's case differs, which would turn every command into a silent success.
const dir = dwgCheckout();
const args = process.argv.slice(2);
if (args[0] === '--where') {
  console.log(resolve(dir));
  process.exit(0);
}
if (args[0] === '--pages') {
  // Regenerate src/dwg and src/vendor from the spec. `dwg app page` writes into a Rayfin app laid out as
  // packages/frontend/src whose rayfin.yml declares a fabric-semanticmodel connector. This app ships neither (the
  // connector makes a deployed app owner-only), so the pages are generated into a throwaway skeleton outside the
  // template that holds nothing deployable (no .deployments.json, no .env), then copied over and patched to English.
  const stage = mkdtempSync(join(tmpdir(), 'caldova-dwg-stage-'));
  try {
    const front = join(stage, 'packages', 'frontend', 'src');
    mkdirSync(join(front, 'hooks'), { recursive: true });
    mkdirSync(join(stage, 'rayfin'), { recursive: true });
    writeFileSync(join(stage, 'rayfin', 'rayfin.yml'), 'id: stage\nname: stage\nconnectors:\n  - name: statements\n    type: fabric-semanticmodel\n');
    writeFileSync(join(front, 'hooks', 'use-semantic-model-query.ts'), 'export {};\n'); // dwg only checks that it exists
    const code = run(dir, ['app', 'page', '--app', stage, '--spec', SPEC, '--connector', 'statements', '--model', MODEL]);
    if (code) process.exit(code);
    for (const sub of ['dwg', 'vendor']) {
      rmSync(resolve(ROOT, 'src', sub), { recursive: true, force: true });
      cpSync(join(front, sub), resolve(ROOT, 'src', sub), { recursive: true });
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  const en = spawnSync(process.execPath, [resolve(ROOT, 'tools', 'dwg-english.mjs')], { cwd: ROOT, stdio: 'inherit' }).status ?? 1;
  if (!en) console.log('src/dwg and src/vendor regenerated. Next: npm run bake, npm run bake:check, lint, test, build, probe.');
  process.exit(en);
}
if (args[0] === '--check') {
  // The spec against its model (structure, roles, fields), then the pixel grid and accessibility.
  const a = run(dir, ['check', '--spec', SPEC, '--model', MODEL]);
  const b = run(dir, ['lint', '--spec', SPEC]);
  process.exit(a || b);
}
if (args.length === 0) args.push('--help');
process.exit(run(dir, args));
