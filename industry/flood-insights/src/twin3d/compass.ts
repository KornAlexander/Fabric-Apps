/**
 * Compass maths — how far the view is turned from north, and how to turn it back.
 *
 * Pure and separate from the scene so the wrap-around can be tested. The interesting case is not
 * "rotate to zero" but "rotate the *short* way to zero": from a heading of 350° the compass has to
 * turn 10° forwards, not 350° backwards, and getting that wrong is the kind of thing that only
 * shows up as a camera spinning the wrong way past every point of the compass.
 */

const TWO_PI = Math.PI * 2;

/**
 * Normalise an angle to (−π, π].
 *
 * OrbitControls reports its azimuth in that range already, but the arithmetic below can leave a
 * value outside it, and a compass that reads 190° instead of −170° points the same way while
 * looking broken.
 */
export function normaliseAngle(radians: number): number {
  let a = radians % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  if (a <= -Math.PI) a += TWO_PI;
  // Collapse negative zero. `-0` points due north exactly as `0` does, but it propagates into
  // every derived figure — a rose rotation of "-0deg", a turn of "-0 rad" — and reads as a bug
  // to anyone who meets it in a debugger.
  return a === 0 ? 0 : a;
}

/**
 * The signed rotation that takes `fromRad` to north by the shorter arc.
 *
 * Always in [−π, π], so the turn never goes the long way round.
 */
export function shortestTurnToNorth(fromRad: number): number {
  return normaliseAngle(-fromRad);
}

/**
 * Screen rotation, in degrees, for a compass rose under a camera at this azimuth.
 *
 * The scene's north is −Z, and OrbitControls measures azimuth from +Z, so a camera at azimuth 0
 * sits south of its target and looks north — north is straight up the screen and the rose is
 * unrotated. As the azimuth grows the view swings westward and north swings to the right of the
 * screen, which is a positive CSS rotation.
 */
export function roseRotationDeg(azimuthRad: number): number {
  return (normaliseAngle(azimuthRad) * 180) / Math.PI;
}

/** True when the view is close enough to north that turning it would be imperceptible. */
export function isFacingNorth(azimuthRad: number, toleranceRad = 0.02): boolean {
  return Math.abs(normaliseAngle(azimuthRad)) <= toleranceRad;
}
