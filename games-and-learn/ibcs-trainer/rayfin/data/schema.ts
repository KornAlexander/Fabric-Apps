import { GameStats } from './GameStats.js';
import { StageProgress } from './StageProgress.js';

/**
 * Schema type definition for the IBCS Trainer app.
 *
 * Maps entity names to their model types, giving full type safety when using
 * the RayfinClient (`client.data.GameStats…`, `client.data.StageProgress…`).
 */
export type DataAppSchema = {
  GameStats: GameStats;
  StageProgress: StageProgress;
};

export const schema = [GameStats, StageProgress];
