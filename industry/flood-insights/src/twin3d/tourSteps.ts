/**
 * The tour steps, kept as a module of their own so existing imports and tests keep working.
 *
 * The steps themselves moved to `stories.ts` when the tour became one of several presets — see
 * the header there for why every story ends on Act IV, and why the general steps stopped framing
 * Altenahr (u=0.10 of the AOI, so a third of the screen was terrain with no data behind it).
 */

export {
  actOf,
  finalStep,
  TOUR_LENGTH,
  TOUR_STEPS,
  type StoryStep as TourStep,
} from './stories';