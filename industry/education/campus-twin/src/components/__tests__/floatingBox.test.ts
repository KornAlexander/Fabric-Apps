import { describe, expect, it } from 'vitest';

import { clampBox, parseStoredBox } from '@/components/floatingBox';

describe('a remembered window box', () => {
  it('is read back when it is four finite numbers', () => {
    expect(parseStoredBox('{"x":40,"y":50,"width":600,"height":400}')).toEqual({ x: 40, y: 50, width: 600, height: 400 });
  });

  it('is ignored when it is anything else', () => {
    for (const raw of [null, undefined, '', 'not json', 'null', '[]', '{"x":1,"y":2,"width":3}', '{"x":"1","y":2,"width":3,"height":4}', '{"x":1,"y":2,"width":null,"height":4}', '{"x":1e999,"y":2,"width":3,"height":4}']) {
      expect(parseStoredBox(raw), String(raw)).toBeNull();
    }
  });
});

const VIEW = { width: 1000, height: 700 };

describe('floating window box', () => {
  it('leaves a box that fits where it is', () => {
    const box = { x: 100, y: 80, width: 400, height: 300 };
    expect(clampBox(box, VIEW)).toEqual(box);
  });

  it('pulls a box dragged past any edge back on screen, title bar included', () => {
    expect(clampBox({ x: -500, y: -500, width: 400, height: 300 }, VIEW)).toMatchObject({ x: 8, y: 8 });
    const far = clampBox({ x: 5000, y: 5000, width: 400, height: 300 }, VIEW);
    expect(far.x + far.width).toBe(VIEW.width - 8);
    expect(far.y + far.height).toBe(VIEW.height - 8);
  });

  it('never grows past the viewport and never shrinks to nothing', () => {
    const huge = clampBox({ x: 0, y: 0, width: 9000, height: 9000 }, VIEW);
    expect(huge).toEqual({ x: 8, y: 8, width: VIEW.width - 16, height: VIEW.height - 16 });
    const tiny = clampBox({ x: 100, y: 100, width: 1, height: 1 }, VIEW);
    expect(tiny.width).toBe(320);
    expect(tiny.height).toBe(240);
  });

  it('lets a small screen win over the minimum size', () => {
    const phone = { width: 320, height: 500 };
    const box = clampBox({ x: 96, y: 72, width: 760, height: 500 }, phone);
    expect(box.x).toBe(8);
    expect(box.x + box.width).toBe(phone.width - 8);
    expect(box.y + box.height).toBeLessThanOrEqual(phone.height - 8);
  });
});
