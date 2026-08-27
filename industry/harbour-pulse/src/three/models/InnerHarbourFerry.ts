import { VoxelFerry } from '@/three/VoxelFerry';

/**
 * Inner Harbour utility ferry — a small single-deck monohull workboat
 * (e.g. Me-mel).
 *
 * Customise this class by overriding the `protected` build stages inherited
 * from `VoxelFerry`: `buildHull`, `buildSuperstructure`, `buildFittings` or
 * `furnish`. Call `super.<stage>()` first to keep the shared look and add to it.
 */
export class InnerHarbourFerry extends VoxelFerry {
  /** A plain, low single saloon — no raised forward-raked wall — for the small
   * utility workboat (e.g. Me-mel). */
  protected buildSuperstructure(): void {
    const L = this.spec.scale.length;
    const B = this.spec.scale.beam;
    const beam = 13 * B;
    const hullLen = 40 * L;
    this.saloon(beam * 0.86, 2.8, hullLen * 0.7, -2 * L, 2.15);
  }

  /** A compact wheelhouse amidships and a short mast — no tall signal mast or
   * destination board on this small workboat. */
  protected buildFittings(): void {
    const m = this.mat;
    const L = this.spec.scale.length;
    const B = this.spec.scale.beam;
    const beam = 13 * B;
    this.box(m.sheer, beam * 0.55, 2.0, 5 * L, 0, 5.6, -2 * L);
    this.box(m.glass, beam * 0.55 + 0.05, 1.1, 5.05 * L, 0, 5.9, -2 * L);
    this.box(m.roof, beam * 0.6, 0.3, 5.4 * L, 0, 6.7, -2 * L);
    this.box(m.chrome, 0.1, 2.0, 0.1, 0, 7.7, -2 * L);
    this.lifeRing(beam * 0.44, 3.7, 3 * L);
    this.lifeRing(-beam * 0.44, 3.7, 3 * L);
  }
}
