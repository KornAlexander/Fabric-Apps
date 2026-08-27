import { describe, expect, it } from 'vitest';

import { DAM_BREAK_SCENARIO } from '@/data/steinbach';
import {
  CORRIDOR,
  CORRIDOR_LENGTH_KM,
  DAM,
  FRONT_CONTROL_POINTS,
  corridorBounds,
  frontCelerityMs,
  frontHasReached,
  frontKmAt,
  publishedArrivalMinutes,
} from '../steinbachCorridor';

describe('the corridor', () => {
  it('runs downstream, so the front never has to go backwards', () => {
    const km = CORRIDOR.map((c) => c.kmFromDam);
    expect(km).toEqual([...km].sort((a, b) => a - b));
  });

  it('falls the whole way, dam to Swist plain', () => {
    const ground = [DAM.groundM, ...CORRIDOR.map((c) => c.groundM)];
    for (let i = 1; i < ground.length; i++) {
      expect(ground[i]).toBeLessThan(ground[i - 1]);
    }
    expect(DAM.groundM - CORRIDOR[CORRIDOR.length - 1].groundM).toBeGreaterThan(100);
  });

  it('names the three villages that were actually evacuated that night', () => {
    const evacuated = CORRIDOR.filter((c) => c.evacuated).map((c) => c.id);
    expect(evacuated).toEqual(['schweinheim', 'flamersheim', 'palmersheim']);
  });

  it('brackets every place in its bounding box', () => {
    const b = corridorBounds();
    for (const place of [DAM, ...CORRIDOR]) {
      expect(place.lon).toBeGreaterThan(b.west);
      expect(place.lon).toBeLessThan(b.east);
      expect(place.lat).toBeGreaterThan(b.south);
      expect(place.lat).toBeLessThan(b.north);
    }
  });
});

describe('the front, interpolated from the published control points', () => {
  it('takes its control points from the sourced scenario, not from a second copy', () => {
    const sourced = DAM_BREAK_SCENARIO.filter((p) => p.travelMinutes !== undefined).length;
    // Plus the origin, which is the failure itself rather than a published observation.
    expect(FRONT_CONTROL_POINTS.length).toBe(sourced + 1);
    expect(FRONT_CONTROL_POINTS[0]).toEqual({ km: 0, minutes: 0 });
  });

  it('has not started before the failure', () => {
    expect(frontKmAt(-30)).toBe(0);
    expect(frontKmAt(0)).toBe(0);
  });

  it('advances monotonically', () => {
    let previous = -1;
    for (let m = 0; m <= 180; m += 5) {
      const km = frontKmAt(m);
      expect(km).toBeGreaterThanOrEqual(previous);
      previous = km;
    }
  });

  it('reaches each published place at the time the study gives', () => {
    for (const place of DAM_BREAK_SCENARIO) {
      if (place.travelMinutes === undefined) continue;
      const onCorridor = CORRIDOR.find((c) => c.id === place.id)!;
      expect(frontKmAt(place.travelMinutes)).toBeCloseTo(onCorridor.kmFromDam, 6);
    }
  });

  it('stops at the end of the corridor rather than running into unmodelled ground', () => {
    expect(frontKmAt(150)).toBeCloseTo(CORRIDOR_LENGTH_KM, 6);
    expect(frontKmAt(10_000)).toBeCloseTo(CORRIDOR_LENGTH_KM, 6);
  });

  it('decelerates, which is the study result and the reason downstream had time', () => {
    const nearDam = frontCelerityMs(5);
    const farOut = frontCelerityMs(120);
    expect(nearDam).toBeGreaterThan(4);
    expect(farOut).toBeLessThan(2);
    expect(nearDam).toBeGreaterThan(farOut);
  });

  it('keeps the front celerity above the flow velocity the study reports at Schweinheim', () => {
    // A dam-break front outruns the water behind it. If this ever inverted, the interpolation
    // would be describing something that is not a surge.
    expect(frontCelerityMs(5)).toBeGreaterThan(3);
  });
});

describe('what the study did not say stays unsaid', () => {
  it('gives Palmersheim no arrival time, however convenient one would be', () => {
    // The data module records that an earlier draft invented 30 minutes here. The front must
    // still sweep past — a continuous wave cannot skip a place — but the figure stays absent.
    expect(publishedArrivalMinutes('palmersheim')).toBeUndefined();
    expect(frontHasReached('palmersheim', 60)).toBe(true);
  });

  it('gives Flamersheim no arrival time either, since the study named no figure for it', () => {
    expect(publishedArrivalMinutes('flamersheim')).toBeUndefined();
  });

  it('does report the times that were published', () => {
    expect(publishedArrivalMinutes('schweinheim')).toBe(10);
    expect(publishedArrivalMinutes('odendorf')).toBe(60);
    expect(publishedArrivalMinutes('heimerzheim')).toBe(150);
  });

  it('has no arrival time for a place that is not in the corridor at all', () => {
    expect(publishedArrivalMinutes('altenahr')).toBeUndefined();
  });
});
