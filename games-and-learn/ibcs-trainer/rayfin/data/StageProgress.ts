import { entity, role, uuid, text, boolean, int, date } from '@microsoft/rayfin-core';

/**
 * One row per IBCS substage (checkpoint) a player has completed.
 *
 * Where {@link GameStats} captures a whole play-through, this entity records the
 * player's *durable progression* through the 7 SUCCESS stages and their 35
 * substages. The Rule Platformer posts a `rayfin-stage-complete` message the
 * moment a substage is cleared; the host (`GamePage`) upserts it here so the
 * player's profile reflects which stages are already done — and so substage
 * checkpoints unlock on any device they sign in from.
 *
 * Each record is scoped to the signed-in player via `user_id` (the Entra/Fabric
 * JWT `sub` claim), so a player only ever sees their own progress.
 */
@entity()
@role('authenticated', '*', {
  policy: (claims, item) => claims.sub.eq(item.user_id),
})
export class StageProgress {
  @uuid() id!: string;

  // Player association via user_id populated from JWT claims.
  @text() user_id!: string;
  @text() player_name!: string;

  // The substage cleared: its flat index (0..34) plus human-readable metadata.
  @int() substage_index!: number;
  @text() substage_code!: string;
  @text() substage_title!: string;

  // The SUCCESS stage (pillar) this substage belongs to.
  @int() stage_index!: number;
  @text() stage_pillar!: string;
  @text({ optional: true }) stage_world?: string;

  // True when this substage was the final one of its stage (whole pillar done).
  @boolean({ optional: true }) stage_completed?: boolean;

  @int({ optional: true }) level_reached?: number;

  @date() completedAt!: Date;
}
