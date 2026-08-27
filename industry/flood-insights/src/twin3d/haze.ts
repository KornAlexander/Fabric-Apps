/**
 * The colour the world fades into, shared by every surface that can reach the horizon.
 *
 * ⚠️ This exists because a video recording showed what no test had: the terrain ended in a hard
 * cliff against a flat `stone-100` clear colour, and a third of the frame was white. A 23 km
 * valley rendered that way reads as a model on a page rather than as a landscape. The fix is the
 * one Gleitschirm-Insights uses — the ground dissolves into the same colour the sky is — and I had
 * earlier looked at that app and wrongly concluded the technique did not transfer. I judged it as
 * a payload question, because there it comes attached to a coarse terrain shell. The shell is
 * optional; the haze is not, and it costs nothing.
 *
 * Three.js `Fog` is unusable here: these are custom `ShaderMaterial`s on `glslVersion: GLSL3`, and
 * the built-in fog chunks are only injected into the stock materials. So every shader that draws
 * something far away mixes toward `HAZE_COLOUR` itself, and they all read the distances from here
 * so they cannot disagree about where the horizon is.
 *
 * Slightly warmer and bluer than the surrounding page so the canvas reads as air rather than as an
 * unpainted rectangle, but close enough that the panels still sit on it comfortably.
 */
export const HAZE_COLOUR = 0xd9dbdc;

/** Ground closer than this is untouched. About the width of the valley floor. */
export const HAZE_NEAR_M = 2_400;

/**
 * Ground at this distance is fully haze.
 *
 * The AOI is 23 km across, so a far plane much beyond that would leave the map edge visible as a
 * hard line before the haze could hide it. 17 km puts full dissolve inside the AOI on every
 * bearing, which is what stops the "ends in a cliff" reading.
 */
export const HAZE_FAR_M = 17_000;
