import { VoxelFerry } from '@/three/VoxelFerry';

/**
 * First Fleet class — small twin-deck inner-harbour commuter ferries
 * (e.g. Borrowdale, Fishburn, Sirius, Friendship, Golden Grove). Monohull with
 * a tall forward wheelhouse and rounded superstructure ends.
 *
 * Customise this class by overriding the `protected` build stages inherited
 * from `VoxelFerry`: `buildHull`, `buildSuperstructure`, `buildFittings` or
 * `furnish`. Call `super.<stage>()` first to keep the shared look and add to it.
 */
export class FirstFleetFerry extends VoxelFerry {
  /** Add the tall, boxy pilot house and extra life rings that give the small
   * First Fleet commuter ferries (e.g. Borrowdale) their top-heavy look. */
  protected buildFittings(): void {
    super.buildFittings();
    const m = this.mat;
    const L = this.spec.scale.length;
    const B = this.spec.scale.beam;
    const beam = 13 * B;
    const wh = this.wheelhouseCenter();
    // A tall pilot house perched above the forward saloon, with a cream
    // name-board band beneath its raked windows.
    this.box(m.sheer, beam * 0.5, 1.4, 4.6 * L, 0, wh.y + 2.4, wh.z);
    this.box(m.trim, beam * 0.54, 0.4, 4.9 * L, 0, wh.y + 1.6, wh.z);
    // Extra life rings along the lower saloon side.
    this.lifeRing(beam * 0.46, 3.7, -2 * L);
    this.lifeRing(-beam * 0.46, 3.7, -2 * L);
  }
}
