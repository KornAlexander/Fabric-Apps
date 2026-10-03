// ⚠️ **The `.js` extensions below are REQUIRED and are not a typo.**
// `rayfin/tsconfig.json` resolves modules as nodenext, so an extensionless
// relative import fails to compile with TS2835 — and the way that failure
// presents is the dangerous part: `rayfin up` still deploys the static app,
// prints that it is live, exits 0, and only a line buried in its log says the
// database configuration failed. The app ships, the tables do not exist, and
// every write fails at runtime against a URL that looks perfectly healthy.
// Campus-Scheduler learned this the hard way; it is copied here rather than
// re-learned.
import { GameResult } from './GameResult.js';
import { QuestionAttempt } from './QuestionAttempt.js';

/**
 * What the game records about itself.
 *
 * TWO tables, and the split is between an OUTCOME and the EVIDENCE for it.
 *
 * `GameResult` is one row per finished campaign: who, which world, how long,
 * how it ended. `QuestionAttempt` is one row per question answered.
 *
 * ⚠️ **The per-game table alone would be almost worthless, and that is the
 * argument for paying for two.** "Won in 40 turns at 62% readiness" cannot say
 * which skills carried it or which were guessed, so it can describe the game
 * and not the learning — and the learning is the entire point of the project.
 * Conversely the attempts alone cannot say whether any of it added up to a win.
 * Each is the other's denominator.
 *
 * ⚠️ **Neither table stores a question's TEXT, and none ever should.** The bank
 * is the asset; a stats table that copied prompts into a second store would put
 * the content somewhere it can drift from the source and somewhere it was never
 * licensed to be. `topicId` and `questionId` are keys into the bank, and the
 * bank stays the only copy.
 */
export type AppSchema = {
  GameResult: typeof GameResult;
  QuestionAttempt: typeof QuestionAttempt;
};

export const schema: AppSchema = { GameResult, QuestionAttempt };
