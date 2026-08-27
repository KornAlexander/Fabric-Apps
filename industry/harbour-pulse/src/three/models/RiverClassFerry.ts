import { VoxelFerry } from '@/three/VoxelFerry';

/**
 * River class — twin-deck harbour catamarans with a forward wheelhouse
 * (e.g. Esme Timbery, Lauren Jackson, Margaret Olley, Ruby Langford, Ruth Park).
 *
 * Customise this class by overriding the `protected` build stages inherited
 * from `VoxelFerry`: `buildHull`, `buildSuperstructure`, `buildFittings` or
 * `furnish`. Call `super.<stage>()` first to keep the shared look and add to it.
 */
export class RiverClassFerry extends VoxelFerry {
  /** Add the open upper sundeck aft of the upper saloon that the modern River
   * class carries (e.g. Esme Timbery, Ruth Park). */
  protected buildSuperstructure(): void {
    super.buildSuperstructure();
    const m = this.mat;
    const L = this.spec.scale.length;
    const B = this.spec.scale.beam;
    const beam = 13 * B;
    const y = 7.0;
    this.box(m.deck, beam * 0.66, 0.3, 3.5 * L, 0, y - 0.5, -16.5 * L);
    this.railRect(-beam * 0.33, beam * 0.33, -18 * L, -15 * L, y);
    this.bench(-2.0 * B, y, -16.5 * L);
    this.bench(2.0 * B, y, -16.5 * L);
  }
}
