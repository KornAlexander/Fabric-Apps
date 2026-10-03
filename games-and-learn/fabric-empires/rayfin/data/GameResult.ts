import { entity, role, uuid, text, boolean, date, int } from '@microsoft/rayfin-core';

/**
 * One finished game.
 *
 * ⚠️ **Nothing about a game has ever survived it.** The save holds exactly one
 * campaign, and starting a new one overwrites it: PLAN §D84 records that the
 * empire was made to persist because the review schedule already did, but that
 * fixed *resuming*, not *remembering*. A player could win twenty games and the
 * only trace afterwards was a mastery table that cannot say how many games
 * there were, how long they ran, or whether any of them were won.
 *
 * PLAN.md has listed `GameStats` and `LeaderboardEntry` as intended entities
 * since the first section. This is the first half of that debt.
 *
 * ⚠️ **`userId` is populated BY THE CLIENT**, from the Fabric session's claim.
 * That makes it exactly as trustworthy as the session, and not a server-stamped
 * audit field. The row-level policy below is what actually constrains reads;
 * the column is for grouping, not for proof. Campus-Scheduler's `PlanChange`
 * carries the same caveat for the same reason.
 */
@entity()
@role('authenticated', '*', {
  /*
   * A player reads their own games and nobody else's.
   *
   * ⚠️ This does NOT lock the data away from analysis, and that is deliberate
   * rather than a hole. Row-level security here is enforced by Data API
   * Builder, which sits in front of the app's GraphQL endpoint. A semantic
   * model connects to the database's SQL analytics endpoint instead, which is
   * a different door with different credentials: the report sees every row.
   * So "each player sees only their own" and "the owner can report across all
   * of it" are both true, without inventing an admin role that this version of
   * Rayfin does not have.
   */
  policy: (claims, item) => claims.sub.eq(item.userId),
})
export class GameResult {
  @uuid() id!: string;

  /** The signed-in player, from the session claim. See the caveat above. */
  @text({ max: 200 }) userId!: string;
  @text({ max: 200, optional: true }) userName?: string;

  /**
   * Enough to rebuild the exact world this was played on.
   *
   * ⚠️ The map is generated, never stored, so the seed and the difficulty ARE
   * the world. Without them a row says a game took 40 turns and cannot say
   * whether that was a small island on gentle or a continent on architect.
   */
  @text({ max: 64 }) seed!: string;
  @text({ max: 32 }) difficulty!: string;
  @int() players!: number;

  /** 'victory' | 'defeat' | 'abandoned'. Abandoned is the common case. */
  @text({ max: 16 }) outcome!: string;
  @int() turns!: number;
  @int() cities!: number;

  /**
   * Exam readiness at the end, as whole percent.
   *
   * ⚠️ Percent as an int rather than a 0..1 decimal, because this is the one
   * number a person will read off a card and a rounding argument in the report
   * layer is a worse place to have it than in the column.
   */
  @int() readinessPercent!: number;
  @int() skillsResearched!: number;

  /**
   * ⚠️ Recorded, because a game won with cheats is not evidence of anything.
   * The end screen already discloses them to the player for that reason; a
   * stats table that quietly dropped them would republish the false confidence
   * the disclosure exists to prevent.
   */
  @text({ max: 400, optional: true }) cheatsUsed?: string;

  @date() startedAt!: Date;
  @date() endedAt!: Date;
  @int() durationSeconds!: number;
}
