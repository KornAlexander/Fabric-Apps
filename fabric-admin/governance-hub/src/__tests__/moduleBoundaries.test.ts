import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Structural guard rails (PLAN.md §8.1, §8.2, §18).
 *
 * Two rules keep the modularity real rather than cosmetic:
 *   1. No module may import from another module — cross-module behaviour goes
 *      through the registry. Otherwise the four planes weld themselves together
 *      and can never be shipped separately.
 *   2. A module must be reachable only via the registry, so adding a fifth
 *      plane later is a folder, not a refactor.
 *
 * Plus the i18n rule: no user-visible literal strings in components.
 */
const SRC = resolve(import.meta.dirname, '..');
const MODULES_DIR = join(SRC, 'modules');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const MODULE_FOLDERS = readdirSync(MODULES_DIR).filter((name) =>
  statSync(join(MODULES_DIR, name)).isDirectory()
);

describe('module boundaries', () => {
  it('has one folder per control plane', () => {
    expect(MODULE_FOLDERS.sort()).toEqual(['agent', 'entra', 'fabric', 'pp']);
  });

  it.each(MODULE_FOLDERS)('module %s does not import another module', (folder) => {
    const others = MODULE_FOLDERS.filter((f) => f !== folder);
    for (const file of walk(join(MODULES_DIR, folder))) {
      const source = readFileSync(file, 'utf8');
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const spec of imports) {
        for (const other of others) {
          const offends =
            spec.includes(`modules/${other}`) ||
            spec === `../${other}` ||
            spec.startsWith(`../${other}/`);
          expect(offends, `${relative(SRC, file)} imports module '${other}'`).toBe(false);
        }
      }
      // Importing the registry from inside a module would create a cycle and
      // let a module reach its siblings through the back door.
      expect(
        imports.includes('..') || imports.includes('../index'),
        `${relative(SRC, file)} imports the module registry`
      ).toBe(false);
    }
  });

  it('reaches modules only through the registry', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      if (file.startsWith(MODULES_DIR)) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/from\s+'(@\/modules\/[^']+)'/g)) {
        // `@/modules/types` is the shared contract and is allowed everywhere.
        if (match[1] === '@/modules/types') continue;
        offenders.push(`${relative(SRC, file)} → ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('no literal user-facing strings in components', () => {
  // Cheap stand-in for eslint-plugin-i18next: catch JSX text nodes that contain
  // real words. Deliberately narrow (>= 4 letters) to avoid punctuation noise.
  //
  // The negative lookbehind skips `=>` and `/>`, so TypeScript generics such as
  // `) => Promise<boolean>` are not mistaken for JSX text.
  const JSX_TEXT =
    /(?<![=/])>\s*([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß' ]{3,})\s*</g;
  const ALLOWLIST = new Set<string>([]);

  const files = walk(SRC).filter(
    (f) => f.endsWith('.tsx') && !f.includes('__tests__') && !f.includes('AuthPage')
  );

  it.each(files.map((f) => relative(SRC, f)))('%s uses t() for visible text', (rel) => {
    const source = readFileSync(join(SRC, rel), 'utf8');
    const hits = [...source.matchAll(JSX_TEXT)]
      .map((m) => m[1].trim())
      .filter((text) => !ALLOWLIST.has(text));
    expect(hits, `literal strings found: ${hits.join(' | ')}`).toEqual([]);
  });
});
