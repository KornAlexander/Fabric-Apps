// Every library that ends up in the browser bundle must carry its licence notice, at the version
// actually installed. A dependency upgrade that forgets the notice fails here, not in an audit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const project = new URL('../', import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, project), 'utf8'));

// npm name -> the label used in public/THIRD-PARTY-NOTICES.txt
const BUNDLED = {
  three: 'Three.js',
  react: 'React',
  'react-dom': 'React DOM',
  scheduler: 'Scheduler',
  '@azure/msal-browser': '@azure/msal-browser',
  '@azure/msal-common': '@azure/msal-common',
  '@microsoft/rayfin-client': '@microsoft/rayfin-client',
  '@microsoft/rayfin-auth-provider-fabric': '@microsoft/rayfin-auth-provider-fabric',
};

test('every runtime dependency is covered by the notice list', async () => {
  const { dependencies } = await json('package.json');
  for (const name of Object.keys(dependencies)) assert.ok(name in BUNDLED, `${name} has no notice entry`);
});

test('the shipped notice names each bundled library at its installed version', async () => {
  const notice = await readFile(new URL('public/THIRD-PARTY-NOTICES.txt', project), 'utf8');
  for (const [name, label] of Object.entries(BUNDLED)) {
    const { version, license } = await json(`node_modules/${name}/package.json`);
    assert.equal(license, 'MIT', `${name} is not MIT; its notice needs its own text`);
    assert.ok(notice.includes(`${label} ${version}`), `${label} ${version} missing from THIRD-PARTY-NOTICES.txt`);
  }
});
