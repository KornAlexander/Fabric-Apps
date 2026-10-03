import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ⚠️ The map's mouse bindings, pinned by reading the source.
 *
 * `createScene3D` needs a WebGL context, so the binding cannot be asserted by
 * constructing it under test. That is exactly the situation this repo's D205
 * guard already handles by reading a function's source, so the same trick is
 * used here.
 *
 * This exists because the binding has now been changed TWICE. It was the
 * standard orbit scheme, was rebound to LEFT: PAN / RIGHT: ROTATE on the
 * reasoning that a map is something you slide, and has been put back. The
 * argument for putting it back is that the world is a 3D scene rather than a
 * flat map, and that Shift+drag — the pan gesture in essentially every 3D tool
 * — is only handed to the user by OrbitControls when the left button is bound
 * to ROTATE. Rebinding LEFT to PAN silently takes Shift+drag away, which is
 * not obvious from the line that does it.
 */
const source = readFileSync(
  join(process.cwd(), 'app', 'src', 'three', 'scene3d.ts'),
  'utf8',
);

describe('⚠️ the map keeps the standard orbit mouse scheme', () => {
  it('binds the left button to ROTATE, which is what gives Shift+drag its pan', () => {
    expect(source).toContain('LEFT: MOUSE.ROTATE');
    // The failure this guards against is subtle: with LEFT bound to PAN the app
    // still works, still pans, and simply has no Shift+drag at all.
    expect(source).not.toContain('LEFT: MOUSE.PAN');
  });

  it('leaves a dedicated pan on the right button', () => {
    expect(source).toContain('RIGHT: MOUSE.PAN');
  });

  it('says WHY, so the next person to flip it has the argument in front of them', () => {
    const near = source.slice(
      Math.max(0, source.indexOf('LEFT: MOUSE.ROTATE') - 1400),
      source.indexOf('LEFT: MOUSE.ROTATE'),
    );
    expect(near).toMatch(/Shift/);
  });
});
