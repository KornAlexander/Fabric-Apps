import { VoxelFerry } from '@/three/VoxelFerry';

/**
 * Freshwater class — large ocean-going twin-deck monohulls with a funnel
 * (e.g. Queenscliff), running the Manly service.
 *
 * Customise this class by overriding the `protected` build stages inherited
 * from `VoxelFerry`: `buildHull`, `buildSuperstructure`, `buildFittings` or
 * `furnish`. Call `super.<stage>()` first to keep the shared look and add to it.
 */
export class FreshwaterClassFerry extends VoxelFerry {
  /** Add the broad black-topped funnel, a tall aft signal mast and the
   * side-slung lifeboats that mark the large ocean-going Freshwater-class
   * Manly ferries (e.g. Queenscliff). */
  protected buildFittings(): void {
    super.buildFittings();
    const m = this.mat;
    const L = this.spec.scale.length;
    const B = this.spec.scale.beam;
    const beam = 13 * B;
    this.box(m.funnel, 2.6 * B, 1.8, 2.8 * B, 0, 11.4, -13 * L);
    this.box(m.boot, 2.9 * B, 0.9, 3.1 * B, 0, 12.6, -13 * L);
    this.box(m.sheer, 0.32, 6.0, 0.32, 0, 12.4, -8 * L);
    this.box(m.chrome, 0.06, 3.0, 0.06, 0, 16.4, -8 * L);
    for (const s of [-1, 1] as const) {
      this.box(m.rail, 1.7, 1.0, 5.0 * L, s * beam * 0.52, 9.9, -5 * L);
      this.box(m.boot, 1.9, 0.4, 5.2 * L, s * beam * 0.52, 9.4, -5 * L);
    }
  }
}
