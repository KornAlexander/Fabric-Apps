import { VoxelFerry } from '@/three/VoxelFerry';

/**
 * Parramatta River class — single-deck RiverCat catamarans with a low profile
 * and an amidships (centre) wheelhouse (e.g. Frances Bodkin, Jack Mundey,
 * John Nutt, Martin Green, Norman Selfe).
 *
 * Customise this class by overriding the `protected` build stages inherited
 * from `VoxelFerry`: `buildHull`, `buildSuperstructure`, `buildFittings` or
 * `furnish`. Call `super.<stage>()` first to keep the shared look and add to it.
 */
export class ParramattaRiverFerry extends VoxelFerry {
  /** A long, low single saloon with large windows and no raised forward-raked
   * wall — keeping the profile low. */
  protected buildSuperstructure(): void {
    const L = this.spec.scale.length;
    const B = this.spec.scale.beam;
    const beam = 13 * B;
    const hullLen = 40 * L;
    this.saloon(beam * 0.9, 3.2, hullLen * 0.84, -1 * L, 2.15);
  }

  /** A compact, streamlined wheelhouse pod amidships and only a stub radar
   * mast — the Parramatta River class sits low to clear the upper-river
   * bridges (e.g. Frances Bodkin, Jack Mundey). */
  protected buildFittings(): void {
    const m = this.mat;
    const L = this.spec.scale.length;
    const B = this.spec.scale.beam;
    const beam = 13 * B;
    this.box(m.sheer, beam * 0.5, 1.8, 6 * L, 0, 5.7, -2 * L);
    this.box(m.glass, beam * 0.5 + 0.05, 1.0, 6.05 * L, 0, 6.0, -2 * L);
    this.box(m.roof, beam * 0.55, 0.3, 6.4 * L, 0, 6.75, -2 * L);
    this.box(m.trim, beam * 0.57, 0.12, 6.5 * L, 0, 6.6, -2 * L);
    this.box(m.chrome, 0.12, 1.6, 0.12, 0, 7.5, -2 * L);
    this.lifeRing(beam * 0.46, 3.7, 4 * L);
    this.lifeRing(-beam * 0.46, 3.7, 4 * L);
  }
}
