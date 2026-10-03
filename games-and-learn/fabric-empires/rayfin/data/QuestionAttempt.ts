import { entity, role, uuid, text, boolean, date, int } from '@microsoft/rayfin-core';

/**
 * One question, one answer.
 *
 * ⚠️ **This is the table the whole project's claim rests on.** The game argues
 * that it teaches DP-600, and until now nothing anywhere could be asked to show
 * that. The mastery store keeps an SM-2 state per topic (repetitions, easiness,
 * lapses) which is what the *scheduler* needs, and it is a running aggregate:
 * it can say a topic is currently weak and cannot say when it was weak, in what
 * situation it was asked, or whether it is getting better.
 *
 * A row per attempt is the difference between "which topics are weak" and
 * "which topics are weak, how often, under what pressure, and since when".
 *
 * ⚠️ **`context` is why this is worth more than a quiz log.** The same question
 * asked while a city is under siege, with a clock running, is not the same
 * measurement as the same question asked during calm research. Recording which
 * one it was is the only way to tell "does not know it" from "cannot recall it
 * under pressure", and those want different remedies.
 */
@entity()
@role('authenticated', '*', {
  // Same reasoning as GameResult: DAB constrains the app, the SQL analytics
  // endpoint that the semantic model uses is a separate door.
  policy: (claims, item) => claims.sub.eq(item.userId),
})
export class QuestionAttempt {
  @uuid() id!: string;

  @text({ max: 200 }) userId!: string;

  /**
   * The game this happened in.
   *
   * ⚠️ A plain column, not a declared relation. The attempt is worth keeping
   * even when the game it belonged to was abandoned and never wrote a
   * `GameResult` row, and a foreign key would make the orphan illegal rather
   * than merely untidy. Losing the answers because the empire was abandoned
   * would throw away the honest half of the data: an abandoned game is still a
   * session of studying.
   */
  @text({ max: 64 }) gameId!: string;

  /** The DP-600 skill, e.g. `dp600-3`. This is the join to the exam outline. */
  @text({ max: 64 }) topicId!: string;
  @text({ max: 120 }) questionId!: string;

  @boolean() correct!: boolean;

  /**
   * Where the question was asked. See the class docblock: this is the column
   * that makes the rest interpretable.
   *
   * The values are the engine's `ChallengeKind` plus the exam screen's own
   * kind: 'battle' | 'settle' | 'unrest' | 'research' | 'treasure' | 'boss' |
   * 'exam'.
   *
   * ⚠️ This list previously read 'founding' and 'review', and neither has ever
   * been written by this build. The drift was found by charting the column: a
   * report grouped by a documented value that does not exist shows an empty
   * category, which reads as "never happened" rather than "never existed".
   */
  @text({ max: 16 }) context!: string;

  /**
   * How long the answer took, in whole seconds.
   *
   * ⚠️ Kept even when the answer was right. A correct answer that took the
   * full clock is a different state of knowledge from an instant one, and it
   * is the leading indicator of the lapse that follows.
   */
  @int() seconds!: number;

  /** 1 or 2. The duo mode seats a second player at their own level. */
  @int() seat!: number;

  /** The course the question came from, so a family game stays separable. */
  @text({ max: 64 }) courseId!: string;

  @date() askedAt!: Date;
}
