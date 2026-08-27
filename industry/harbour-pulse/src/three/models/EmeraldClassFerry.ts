import { VoxelFerry } from '@/three/VoxelFerry';

/**
 * Emerald class — single-deck harbour catamarans with a centre wheelhouse
 * (e.g. May Gibbs).
 *
 * Customise this class by overriding the `protected` build stages inherited
 * from `VoxelFerry`: `buildHull`, `buildSuperstructure`, `buildFittings` or
 * `furnish`. Call `super.<stage>()` first to keep the shared look and add to it.
 */
export class EmeraldClassFerry extends VoxelFerry {
  /** Add the open upper sundeck over the aft saloon roof — ringed with rails,
   * dressed with benches — that the Emerald class carries (e.g. May Gibbs). */
  protected buildSuperstructure(): void {
    super.buildSuperstructure();
    const m = this.mat;
    const L = this.spec.scale.length;
    const B = this.spec.scale.beam;
    const beam = 13 * B;
    const hullLen = 40 * L;
    const roofY = 6.0;
    this.box(m.deck, beam * 0.68, 0.3, hullLen * 0.3, 0, roofY, -9 * L);
    this.railRect(-beam * 0.34, beam * 0.34, -9 * L - hullLen * 0.15, -9 * L + hullLen * 0.15, roofY + 0.15);
    this.bench(-2.2 * B, roofY + 0.15, -7 * L);
    this.bench(2.2 * B, roofY + 0.15, -11 * L);
  }
}
