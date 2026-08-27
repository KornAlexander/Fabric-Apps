import { VoxelFerry } from '@/three/VoxelFerry';

/**
 * HarbourCat class — sleek single-deck harbour catamarans with a centre
 * wheelhouse (e.g. Victor Chang).
 *
 * Customise this class by overriding the `protected` build stages inherited
 * from `VoxelFerry`: `buildHull`, `buildSuperstructure`, `buildFittings` or
 * `furnish`. Call `super.<stage>()` first to keep the shared look and add to it.
 */
export class HarbourCatFerry extends VoxelFerry {
  /** Add the low streamlined roof fairing and a short, raked signal mast that
   * give the sleek 1990s HarbourCats their look (e.g. Victor Chang). */
  protected buildFittings(): void {
    super.buildFittings();
    const m = this.mat;
    const L = this.spec.scale.length;
    const B = this.spec.scale.beam;
    const beam = 13 * B;
    const wh = this.wheelhouseCenter();
    this.box(m.roof, beam * 0.5, 0.35, 10 * L, 0, 5.9, -4 * L);
    const mast = this.box(m.chrome, 0.12, 3.2, 0.12, 0, wh.y + 2.2, wh.z - 1 * L);
    mast.rotation.x = -0.4;
  }
}
