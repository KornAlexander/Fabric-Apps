import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ASSET_FILES, cleanDescriptor, inheritedName, privateCoordinate, configWithoutHostingRedirect, withoutApprovedRelay, withoutApprovedFabricIds, APPROVED_AGENT_ORIGIN, APPROVED_RELAY_ORIGIN } from '../tools/map-assets.mjs';

test('only map assets are admitted', () => {
  assert.equal(ASSET_FILES.length, 17);
  assert(ASSET_FILES.includes('drape.jpg'));
  assert(ASSET_FILES.includes('buildings_lod2.bin'));
  for (const name of ['rooms.json', 'occupancy.bin', 'drive-route.json', 'staffing.json']) assert(!ASSET_FILES.includes(name));
});
test('metadata cleanup preserves geometry and licenses, but not inherited labels', () => {
  const original = { count: 1, vertexCount: 9, attribution: 'required notice', quantisation: { xzScaleM: 0.25, yScaleM: 0.01, yOffsetM: 503 }, buildings: [{ village: 'Old campus', vertexStart: 0, vertexCount: 9, groundElevM: 511.89, roofVertexStart: 6, wall: 1, arbitrary: 'private' }] };
  const result = cleanDescriptor('buildings_lod2.json', original);
  assert.equal(result.buildings[0].village, 'Munich');
  assert.equal(result.buildings[0].groundElevM, 511.89);
  assert.equal(result.buildings[0].roofVertexStart, 6);
  assert.equal(result.attribution, original.attribution);
  assert.deepEqual(result.quantisation, original.quantisation);
  assert.equal(result.buildings[0].arbitrary, undefined);
  assert.equal(original.buildings[0].village, 'Old campus');
  assert.deepEqual(cleanDescriptor('heightmap.json', { focusPlaces: [{ name: 'Old campus' }] }).focusPlaces, []);
  assert.throws(() => cleanDescriptor('rooms.json', {}));
});
test('identity scanner has positive and negative controls', () => {
  assert(inheritedName.test('old campus planner'));
  assert(inheritedName.test('Universitätsgebäude'));
  assert(privateCoordinate.test('11111111-2222-3333-4444-555555555555'));
  assert(privateCoordinate.test('Bearer example-token'));
  assert(!inheritedName.test('Munich city map, OpenStreetMap contributors'));
  assert(!privateCoordinate.test('https://www.geodaten.bayern.de'));
});
test('new tree transforms preserve decoded physical height', async () => {
  const source = await readFile(new URL('../src/map/vegetation.ts', import.meta.url), 'utf8');
  assert(source.includes('const height = view.getUint8(offset + 6) * 0.2;'));
  assert(source.includes('scale.set(tree.radius, tree.height, tree.radius)'));
  assert(!/height:\s*height\s*\*/.test(source));
});

test('deployment redirect exception cannot exempt identity elsewhere', () => {
  const ownRedirect = '    allowedRedirectUris:\n      - http://127.0.0.1:4188\n      - https://test-map-swedencentral.webapp.fabricapps.net\n  data:\n    enabled: false';
  assert(!privateCoordinate.test(configWithoutHostingRedirect(ownRedirect)));
  assert(privateCoordinate.test(configWithoutHostingRedirect('endpoint: https://test-map-swedencentral.webapp.fabricapps.net')));
  assert(privateCoordinate.test(configWithoutHostingRedirect(ownRedirect + '\ntenant: 11111111-2222-3333-4444-555555555555')));
  assert(privateCoordinate.test(configWithoutHostingRedirect(ownRedirect.replace('.net\n', '.net?token=example\n'))));
  assert(inheritedName.test('aRenovation and calendars'));
  assert(!inheritedName.test('required license condition'));
});

test('the approved-origin exception cannot be used to smuggle an identifier past the scanner', () => {
  // ⚠️ A DOT SEGMENT NORMALISES AWAY. `new URL()` resolves `/<guid>/../health` to `/health`, so an
  // exception that judged the PARSED path and then deleted the ORIGINAL string would erase the
  // GUID before the scanner ever saw it. Caught in review; this is the regression guard.
  const smuggled = `${APPROVED_AGENT_ORIGIN}/11111111-2222-3333-4444-555555555555/../health`;
  assert.equal(withoutApprovedRelay(smuggled), smuggled, 'a non-canonical URL must not be stripped');
  assert(privateCoordinate.test(withoutApprovedRelay(smuggled)), 'the smuggled GUID must still be caught');

  const encoded = `${APPROVED_AGENT_ORIGIN}/11111111-2222-3333-4444-555555555555/%2e%2e/health`;
  assert(privateCoordinate.test(withoutApprovedRelay(encoded)), 'encoded dot segments must not help either');

  // The genuine, canonical forms must still be accepted, or the exception is useless.
  assert.equal(withoutApprovedRelay(APPROVED_AGENT_ORIGIN), '[approved-public-origin]');
  assert.equal(withoutApprovedRelay(`${APPROVED_RELAY_ORIGIN}/adsb/point`), '[approved-public-origin]');
  // A different container app in the same environment is still rejected.
  const other = 'https://ca-something-else.example-env.northeurope.azurecontainerapps.io/health';
  assert.equal(withoutApprovedRelay(other), other);
  assert(privateCoordinate.test(withoutApprovedRelay(other)));
});

test('approved Fabric ids are four exact values, not a GUID-shaped hole', () => {
  const stranger = '11111111-2222-3333-4444-555555555555';
  assert.equal(withoutApprovedFabricIds(stranger), stranger);
  assert(privateCoordinate.test(withoutApprovedFabricIds(stranger)));
});