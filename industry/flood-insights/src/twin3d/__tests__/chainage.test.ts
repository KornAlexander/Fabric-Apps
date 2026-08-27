import { describe, expect, it, vi } from 'vitest';

import {
  NOT_CONNECTED,
  resolveBuildingChainage,
  resolveSiteChainage,
  type ChainageGrid,
  type ChainageOrigin,
} from '../chainage';

/**
 * A 4x3 grid of 16 m cells. Column 1 is the river, carrying chainage 0 at the top row and
 * increasing southwards; everything else is unreachable.
 */
const NOT = 65535;
const grid: ChainageGrid = {
  data: new Uint16Array([
    NOT, 0, NOT, NOT,
    NOT, 7, NOT, NOT,
    NOT, 9, NOT, NOT,
  ]),
  width: 4,
  height: 3,
  resolutionM: 16,
  notConnected: NOT,
  chainagePoints: 8,
};

/** West edge at 300 000 E, north edge at 5 600 000 N. */
const origin: ChainageOrigin = { easting: 300_000, northingTop: 5_600_000 };

/**
 * The sample point of cell (col, row).
 *
 * The lookup is node-centred: it rounds the offset from the origin to the nearest whole cell,
 * so cell (0,0) sits exactly on the origin corner rather than half a cell inside it.
 */
function cell(col: number, row: number) {
  return {
    easting: origin.easting + col * grid.resolutionM,
    northing: origin.northingTop - row * grid.resolutionM,
  };
}

describe('resolveSiteChainage', () => {
  it('reads the chainage index of the cell the site falls in', () => {
    expect(resolveSiteChainage(cell(1, 0), grid, origin)).toBe(0);
    expect(resolveSiteChainage(cell(1, 1), grid, origin)).toBe(7);
  });

  it('returns not-connected where no water route exists', () => {
    expect(resolveSiteChainage(cell(0, 0), grid, origin)).toBe(NOT_CONNECTED);
    expect(resolveSiteChainage(cell(3, 2), grid, origin)).toBe(NOT_CONNECTED);
  });

  it('returns not-connected outside the grid', () => {
    expect(resolveSiteChainage({ easting: 299_000, northing: 5_599_990 }, grid, origin)).toBe(
      NOT_CONNECTED
    );
    expect(resolveSiteChainage({ easting: 400_000, northing: 5_599_990 }, grid, origin)).toBe(
      NOT_CONNECTED
    );
    expect(resolveSiteChainage({ easting: 300_010, northing: 5_700_000 }, grid, origin)).toBe(
      NOT_CONNECTED
    );
  });

  it('clamps an index past the end of the reach', () => {
    // Cell (1,2) holds 9, one past the last of eight points.
    expect(resolveSiteChainage(cell(1, 2), grid, origin)).toBe(7);
  });

  /**
   * The regression this module exists for. A building metadata file written without
   * easting/northing used to sail through the bounds check as NaN and land on chainage 0,
   * which is the top of the reach and metres above everything downstream — so the whole
   * valley rendered submerged. A missing coordinate must read as dry, not as drowned.
   */
  it('treats a site with no usable coordinate as not connected, never as chainage 0', () => {
    const nowhere = {} as unknown as { easting: number; northing: number };
    expect(resolveSiteChainage(nowhere, grid, origin)).toBe(NOT_CONNECTED);
    expect(resolveSiteChainage({ easting: NaN, northing: 5_599_990 }, grid, origin)).toBe(
      NOT_CONNECTED
    );
    expect(resolveSiteChainage({ easting: 300_024, northing: NaN }, grid, origin)).toBe(
      NOT_CONNECTED
    );
  });
});

describe('resolveBuildingChainage', () => {
  it('resolves a list in order', () => {
    const out = resolveBuildingChainage([cell(1, 0), cell(0, 0), cell(1, 1)], grid, origin);
    expect(Array.from(out)).toEqual([0, NOT_CONNECTED, 7]);
  });

  it('warns loudly when the asset carries no coordinates, rather than drowning the valley', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = [{}, {}] as unknown as { easting: number; northing: number }[];
    const out = resolveBuildingChainage(broken, grid, origin);
    expect(Array.from(out)).toEqual([NOT_CONNECTED, NOT_CONNECTED]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('2 of 2');
    warn.mockRestore();
  });

  it('stays quiet when every building is locatable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveBuildingChainage([cell(1, 0), cell(2, 2)], grid, origin);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
