import { stageFromRating } from './hydrograph';

/**
 * Dam-break water-surface profile for the Steinbach corridor — the corridor's answer to
 * `hydrograph.ts`.
 *
 * ⚠️ HONESTY NOTE, read before changing anything here.
 *
 * This models a flood that DID NOT HAPPEN. The dam held. Everything below describes a scenario
 * from the Hydrotec / e-regio study, under the assumptions its authors stated: the reservoir full
 * to the crest as it stood on 14 July 2021, no rain inflow, and a complete failure within seconds.
 *
 * What is sourced, and what is not:
 *
 *   sourced   1.5 million m³ released                      (study)
 *   sourced   water at Schweinheim after 10 minutes        (study)
 *   sourced   3–5 m deep there, moving at 3 m/s            (study)
 *   sourced   bed profile and cross-sections               (DGM1, Geobasis NRW)
 *   MODEL     the recession shape between those anchors
 *   MODEL     how the peak attenuates down the reach
 *
 * The depth this produces is therefore a *modelled* depth and every surface that shows it has to
 * say so — the same rule the Ahr's hydrograph runs under, with one extra condition on top of it,
 * because the Ahr at least happened.
 *
 * WHY THERE IS A MODEL HERE AT ALL. The scene used to draw only the front's position, on the
 * reasoning that the study publishes depths for two of its four places and drawing a surface
 * would mean inventing the other two. That reasoning protected against inventing *figures*. It
 * also meant the corridor could not show what the Ahr shows. The resolution is not to invent the
 * missing depths but to derive them the same way the Ahr derives its own — from the released
 * volume and the real cross-sections — and then to hold the result against the study's published
 * depth as a check rather than feed it in as an input. See `steinbachDamBreak.test.ts`.
 */

/**
 * Speed of the wave FRONT down the reach, metres per second.
 *
 * ⚠️ Not the study's 3 m/s. That figure is the modelled flow velocity *through Schweinheim* — the
 * speed of the water — and a dam-break front outruns the water it carries. Taking 3 m/s as the
 * front speed put the arrival at Schweinheim at 21.5 minutes against the published 10.
 *
 * So this is derived instead, from two measured things: the path along the chainage from the dam
 * to Schweinheim is 3,875 m, and the study puts the water there after 10 minutes. 3875 / 600 =
 * 6.46 m/s, which is faster than 3 m/s, which is the right sign.
 */
export const FRONT_CELERITY_MS = 6.46;

/**
 * Breach recession constant, minutes. Q(t) = peak · exp(−t / T), so ∫Q dt = V fixes the peak at
 * V / (60 T) — 2,500 m³/s for 1.5 Mm³ over T = 10.
 *
 * A complete failure "within seconds" means the peak is immediate; the only real freedom is how
 * fast it falls away. At T = 10 min, 63 % of the reservoir has passed the wall by the time the
 * front reaches Schweinheim, which is consistent with a basin this size emptying in well under an
 * hour.
 */
export const BREACH_DECAY_MINUTES = 10;

/**
 * Distance over which the peak attenuates, metres. Qpeak(x) = Qpeak(0) · exp(−x / L).
 *
 * **This is the one fitted parameter, and what it was fitted to is the point.** Schweinheim's own
 * cross-section, cut from DGM1 and solved with Manning, needs 1,737 m³/s to stand 4 m deep. The
 * breach peak is 2,500 m³/s and the village is 3,875 m downstream, so L = 3875 / ln(2500/1737) =
 * 10,650 m. Every other number here is sourced or measured; this one is chosen so the model
 * reproduces the study's published depth instead of contradicting it.
 */
export const ATTENUATION_LENGTH_M = 10_650;

/** Released volume, m³. Sourced — the study's stated parameter. */
export const RELEASE_VOLUME_M3 = 1_500_000;

/** Peak discharge at the wall, m³/s. Follows from the volume and the recession. */
export const BREACH_PEAK_M3S = RELEASE_VOLUME_M3 / (60 * BREACH_DECAY_MINUTES);

/** Outflow at the breach itself, m³/s, `minutes` after the failure. */
export function breachDischargeAt(minutes: number): number {
  if (minutes <= 0) return 0;
  return BREACH_PEAK_M3S * Math.exp(-minutes / BREACH_DECAY_MINUTES);
}

/** Volume that has passed the wall by `minutes`, m³. Tends to RELEASE_VOLUME_M3. */
export function releasedVolumeM3(minutes: number): number {
  if (minutes <= 0) return 0;
  return RELEASE_VOLUME_M3 * (1 - Math.exp(-minutes / BREACH_DECAY_MINUTES));
}

/** Metres the front has travelled from the dam by `minutes`. */
export function frontDistanceM(minutes: number): number {
  return minutes <= 0 ? 0 : minutes * 60 * FRONT_CELERITY_MS;
}

export interface DamBreakOptions {
  /** Minutes since the failure. Negative is before it: the reach is dry. */
  minutes: number;
  /** Bed elevation per chainage point, from the flow field. */
  bedProfileM: readonly number[] | Float64Array;
  /** Shared discharge levels of the Manning rating. */
  ratingDischargeM3s: readonly number[];
  /** Stage above bed per chainage point, per discharge level. */
  ratingStageM: readonly (readonly number[])[];
  /** Chainage index of the dam. NOT zero — the line starts above the reservoir. */
  releaseIndex: number;
  /** Spacing of the chainage points, metres. */
  chainageStepM: number;
}

/**
 * The water surface at one instant: one elevation per chainage point.
 *
 * Above the dam and ahead of the front the surface is the bed itself, which the shader reads as
 * zero depth. In between, the local discharge is the attenuated peak on the recession curve,
 * lagged by the travel time to that point, and the stage comes from that chainage point's own
 * rating — so a narrow reach stands deeper than a wide one at the same discharge, which is the
 * whole reason the Ahr stopped using a single stage.
 */
export function buildDamBreakWseProfile(options: DamBreakOptions): Float64Array {
  const { minutes, bedProfileM, ratingDischargeM3s, ratingStageM, releaseIndex, chainageStepM } =
    options;
  const count = bedProfileM.length;
  const wse = new Float64Array(count);

  for (let i = 0; i < count; i++) {
    const bed = bedProfileM[i];
    // Upstream of the wall there is no dam break — that water is the reservoir, drawn separately.
    if (i < releaseIndex) {
      wse[i] = bed;
      continue;
    }
    const distance = (i - releaseIndex) * chainageStepM;
    const lagMinutes = distance / FRONT_CELERITY_MS / 60;
    // ⚠️ Dry until the front actually gets here, and this is the ONLY gate — comparing the
    // distance against the front's travel looked equivalent and was not. At the release point
    // itself the distance and the reach are both zero, so a `>` test let it through, and the
    // recession term exp(−(t − lag)/T) with t negative is exp(of a positive number): the wall
    // flooded *harder than the peak*, five minutes before the dam failed. Testing the clock
    // against the arrival lag has no such corner.
    if (minutes <= lagMinutes) {
      wse[i] = bed;
      continue;
    }
    const peakHere = BREACH_PEAK_M3S * Math.exp(-distance / ATTENUATION_LENGTH_M);
    const q = peakHere * Math.exp(-(minutes - lagMinutes) / BREACH_DECAY_MINUTES);
    const stage = stageFromRating(q, ratingDischargeM3s, ratingStageM[i]);
    wse[i] = bed + Math.max(0, stage);
  }
  return wse;
}
