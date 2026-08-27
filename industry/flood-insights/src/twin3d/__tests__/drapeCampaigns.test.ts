import { describe, expect, it } from 'vitest';

import { campaignGammaAt, type DrapeCampaign } from '../terrainLoader';

/**
 * The per-flight exposure match.
 *
 * An orthophoto product is a mosaic of campaigns; the Ahr's box straddles two flights of 2023 that
 * differ by 20 % in brightness where they meet, which is what made the map read as two datasets.
 * The correction is an exponent per campaign, composed with the AOI-wide one in the shader.
 *
 * What has to hold is mostly about restraint: the reference flight must come back EXACTLY 1, and
 * anywhere no campaign is declared must come back 1 too. Both cases are the ones where returning
 * "something reasonable" would quietly apply one flight's exposure to another flight's pixels.
 */

// The Ahr's real figures: 07.09.2023 is the reference (it resolves more detail), 27.05.2023 is
// lifted to match it.
const AHR: DrapeCampaign[] = [
  { acquired: '07.09.2023', u0: 0, u1: 0.198, gamma: 1 },
  { acquired: '27.05.2023', u0: 0.198, u1: 1, gamma: 0.8114 },
];

describe('campaignGammaAt', () => {
  it('leaves the reference flight exactly alone', () => {
    // Not "close to 1" — exactly 1. The whole point of choosing a reference is that its pixels are
    // not touched, and a 0.999 here would be an undeclared correction of the untouched one.
    expect(campaignGammaAt(AHR, 0)).toBe(1);
    expect(campaignGammaAt(AHR, 0.1)).toBe(1);
  });

  it('corrects the other flight', () => {
    expect(campaignGammaAt(AHR, 0.5)).toBe(0.8114);
    expect(campaignGammaAt(AHR, 1)).toBe(0.8114);
  });

  it('renders the two flights alike, which is the entire claim', () => {
    // Measured means either side of the boundary, on comparable ground, and the AOI-wide exposure
    // re-derived on the matched image.
    const west = 0.373;
    const east = 0.296;
    const renderGamma = 0.7866;

    const uncorrected = east ** renderGamma / west ** renderGamma;
    const renderedWest = west ** (renderGamma * campaignGammaAt(AHR, 0.1));
    const renderedEast = east ** (renderGamma * campaignGammaAt(AHR, 0.5));
    const corrected = renderedEast / renderedWest;

    // Without the correction the two flights render 15 % apart, which is what a straight line
    // across the middle of the valley looked like.
    expect(1 - uncorrected).toBeGreaterThan(0.15);
    // With it they agree to better than 0.2 %. Not exactly, and deliberately not: the exponent is
    // stored to four decimals in drape_campaigns.json, and that rounding is the whole residual.
    expect(Math.abs(1 - corrected)).toBeLessThan(0.002);
  });

  it('changes nothing for an AOI that is a single flight', () => {
    expect(campaignGammaAt([], 0.5)).toBe(1);
  });

  it('does not lend a correction to ground no campaign claims', () => {
    // A gap means the metadata did not cover it. Reaching for the nearest campaign would apply one
    // flight's exposure to pixels from another.
    const gapped: DrapeCampaign[] = [
      { acquired: 'a', u0: 0, u1: 0.2, gamma: 0.8 },
      { acquired: 'b', u0: 0.6, u1: 1, gamma: 1 },
    ];
    expect(campaignGammaAt(gapped, 0.4)).toBe(1);
    expect(campaignGammaAt(gapped, 0.2)).toBe(0.8);
    expect(campaignGammaAt(gapped, 0.6)).toBe(1);
  });

  it('survives a camera that has not resolved a position yet', () => {
    expect(campaignGammaAt(AHR, NaN)).toBe(1);
  });
});
