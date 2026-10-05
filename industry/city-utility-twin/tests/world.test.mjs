/**
 * The world's shape, checked rather than remembered.
 *
 * Two things here can drift apart silently and both would fail at runtime in a way that looks
 * like something else:
 *
 *  1. `tools/asset-build-config.mjs` duplicates the core list, because it runs inside the Vite
 *     config before any TypeScript exists and cannot import `src/config/world.ts`. A core added
 *     to one and not the other gives either a missing manifest or an unshipped asset directory.
 *  2. The asset contract now allows a core to omit files. That is what lets the airfield core
 *     ship without tree data and with four drape quadrants — and it is also what would let a
 *     half-built core through unnoticed, so the shape of each core is asserted here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { CORES } from '../tools/asset-build-config.mjs';
import { inspectCore } from '../tools/asset-release.mjs';
import { DRAPE_TILES } from '../src/assets/contract.mjs';

const projectUrl = (path) => new URL(`../${path}`, import.meta.url);
// fileURLToPath, not `.pathname.slice(1)`: slicing only strips the slash before a Windows drive
// letter and turns a Linux path into a relative one, which failed every core lookup in CI.
const projectPath = (path) => fileURLToPath(projectUrl(path));

test('the build core list matches the app site list', async () => {
  const source = await readFile(projectUrl('src/config/world.ts'), 'utf8');
  // The ids as the app declares them, in declaration order.
  const declared = [...source.matchAll(/^\s{4}id:\s*'([a-z0-9-]+)',$/gm)].map((m) => m[1]);
  assert.deepEqual(
    declared,
    [...CORES],
    'src/config/world.ts and tools/asset-build-config.mjs disagree about which cores exist'
  );
});

/** site id -> world id, and world id -> shell core, as src/config/world.ts declares them. */
async function declaredWorlds() {
  const source = await readFile(projectUrl('src/config/world.ts'), 'utf8');
  const siteWorld = Object.fromEntries(
    [...source.matchAll(/^\s{4}id:\s*'([a-z0-9-]+)',\s*\n\s{4}world:\s*'([a-z0-9-]+)',$/gm)].map((m) => [m[1], m[2]]),
  );
  const shells = Object.fromEntries(
    [...source.matchAll(/^\s{2}([a-z0-9-]+):\s*\{\s*shellSite:\s*'([a-z0-9-]+)'\s*\},$/gm)].map((m) => [m[1], m[2]]),
  );
  return { siteWorld, shells };
}

const coreBox = (m) => ({
  minE: m.origin.easting, minN: m.origin.northing,
  maxE: m.origin.easting + m.width * m.resolutionM, maxN: m.origin.northing + m.height * m.resolutionM,
});

test('every shipped core belongs to a world, and every world shell is a shipped core that has one', async () => {
  const { siteWorld, shells } = await declaredWorlds();
  assert.deepEqual(Object.keys(siteWorld), [...CORES], 'a core has no world in src/config/world.ts');
  assert.ok(Object.keys(shells).length > 0, 'no world shells declared');
  for (const [worldId, shellSite] of Object.entries(shells)) {
    if (!Object.values(siteWorld).includes(worldId)) continue; // a world with no shipped core yet
    assert.equal(siteWorld[shellSite], worldId, `${worldId}'s shell core ${shellSite} is not one of its cores`);
    const manifest = await inspectCore(projectPath(`public/terrain/${shellSite}`));
    assert.equal(manifest.files['shell.u16'].state, 'present');
    assert.equal(manifest.files['shell-drape.jpg'].state, 'present');
  }
});

test('every core lies inside its own world\'s shell', async () => {
  // A core outside its shell ends in a cliff over the void, and a flight between two cores of
  // one world crosses a hole. Checked per world: the cities are separate scenes.
  const { siteWorld, shells } = await declaredWorlds();
  for (const [site, worldId] of Object.entries(siteWorld)) {
    const meta = JSON.parse(await readFile(projectUrl(`public/terrain/${site}/heightmap.json`), 'utf8'));
    const shell = JSON.parse(await readFile(projectUrl(`public/terrain/${shells[worldId]}/shell.json`), 'utf8'));
    const core = coreBox(meta);
    const box = coreBox(shell);
    assert.ok(core.minE >= box.minE && core.minN >= box.minN && core.maxE <= box.maxE && core.maxN <= box.maxN,
      `${site} is not inside the ${worldId} shell`);
  }
});

test('each core ships exactly one form of imagery', async () => {
  for (const id of CORES) {
    const manifest = await inspectCore(projectPath(`public/terrain/${id}`));
    const single = manifest.files['drape.jpg'].state === 'present';
    const tiles = DRAPE_TILES.filter((name) => manifest.files[name].state === 'present').length;
    assert.ok(
      (single && tiles === 0) || (!single && tiles === DRAPE_TILES.length),
      `${id} has single=${single} tiles=${tiles}, which is neither form`
    );
  }
});

test('the airfield core declares no vegetation rather than shipping empty vegetation', async () => {
  // Not a style point: an empty vegetation payload would load, draw nothing and report a tree
  // count of zero, which is indistinguishable from a broken tree layer. Absence is declared.
  const manifest = await inspectCore(projectPath('public/terrain/flughafen'));
  assert.equal(manifest.files['vegetation.json'].state, 'absent');
  assert.equal(manifest.files['vegetation.bin'].state, 'absent');
});

test('Munich\'s two cores are far enough apart to need one shared shell', async () => {
  // The whole two-core design exists because the sites are tens of kilometres apart. If a future
  // core landed next to an existing one this assumption, and the union shell built for it, would
  // need revisiting rather than silently still working.
  const metas = await Promise.all(
    ['munich', 'flughafen'].map(async (id) =>
      JSON.parse(await readFile(projectUrl(`public/terrain/${id}/heightmap.json`), 'utf8'))
    )
  );
  const centre = (m) => ({
    e: m.origin.easting + (m.width * m.resolutionM) / 2,
    n: m.origin.northing + (m.height * m.resolutionM) / 2,
  });
  const a = centre(metas[0]);
  const b = centre(metas[1]);
  const separation = Math.hypot(a.e - b.e, a.n - b.n);
  assert.ok(separation > 20000, `cores are only ${Math.round(separation)} m apart`);

  // And the shell has to contain both, or the flight between them crosses a hole.
  const shell = JSON.parse(await readFile(projectUrl('public/terrain/flughafen/shell.json'), 'utf8'));
  const shellMaxE = shell.origin.easting + shell.width * shell.resolutionM;
  const shellMaxN = shell.origin.northing + shell.height * shell.resolutionM;
  for (const meta of metas) {
    assert.ok(meta.origin.easting >= shell.origin.easting, 'core starts west of the shell');
    assert.ok(meta.origin.northing >= shell.origin.northing, 'core starts south of the shell');
    assert.ok(meta.origin.easting + meta.width * meta.resolutionM <= shellMaxE, 'core runs east of the shell');
    assert.ok(meta.origin.northing + meta.height * meta.resolutionM <= shellMaxN, 'core runs north of the shell');
  }
});
