/**
 * Compass maths — which way the view is pointing, and how to turn it back to north.
 *
 * Pure and separate from the scene so the wrap-around can be tested. The interesting case is not
 * "turn to north" but "turn the *short* way to north": from a heading of 350° the camera has to
 * swing 10° forwards, not 350° backwards, and getting that wrong only shows up as a camera
 * spinning past every other point of the compass on its way home.
 *
 * ⚠️ ONE DEFINITION OF "HEADING", USED BY EVERY SURFACE THAT SHOWS ONE. The drone HUD prints a
 * heading in degrees and the rose draws the same fact as a picture; if they are computed in two
 * places they will eventually disagree, and they already did — see {@link headingRadFromForward}.
 *
 * World convention, from `scene.ts` (`worldFromMeta`): +x is east and +z is south, so north is
 * −z. A heading is measured CLOCKWISE FROM NORTH, like every compass rose and every aviation
 * heading: north 0, east 90, south 180, west 270.
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
  // every derived figure — a rose rotation of "-0deg", a turn of "-0 rad" — and reads as a bug to
  // anyone who meets it in a debugger.
  return a === 0 ? 0 : a;
}

/**
 * The compass heading of a view direction, in radians clockwise from north.
 *
 * ⚠️ THE SIGN HERE WAS WRONG IN THE DRONE HUD AND SAID SO IN ITS OWN COMMENT. `flyControls`
 * computed `atan2(-forward.x, -forward.z)`, which is anticlockwise: flying due east the
 * instrument read **270**, i.e. west, while claiming to be "degrees clockwise from north".
 * Measured on all four cardinals before changing it (`temp/cs_heading_check.mjs`). The `-z` is
 * north, so the north component is `-forward.z`; the east component is `+forward.x`, and putting
 * a minus on it mirrors the world.
 */
export function headingRadFromForward(x: number, z: number): number {
  return normaliseAngle(Math.atan2(x, -z));
}

/** The same heading as an instrument reading: 0–360, clockwise from north. */
export function headingDegFromForward(x: number, z: number): number {
  return ((headingRadFromForward(x, z) * 180) / Math.PI + 360) % 360;
}

/**
 * The view heading of an orbit camera at this azimuth.
 *
 * OrbitControls measures azimuth about +y starting from +z, and the camera sits at that azimuth
 * *looking back at its target*. So azimuth 0 puts the camera due south of what it is watching and
 * the view points north; as the azimuth grows the camera swings east and the view swings west.
 * The heading is therefore the azimuth negated, not the azimuth.
 */
export function headingFromAzimuth(azimuthRad: number): number {
  return normaliseAngle(-azimuthRad);
}

/** The azimuth an orbit camera needs in order to look along this heading. Inverse of the above. */
export function azimuthFromHeading(headingRad: number): number {
  return normaliseAngle(-headingRad);
}

/**
 * The signed turn that takes `headingRad` to north by the shorter arc. Always in [−π, π].
 */
export function shortestTurnToNorth(headingRad: number): number {
  return normaliseAngle(-headingRad);
}

/**
 * Screen rotation, in degrees, for a compass rose under a view with this heading.
 *
 * The rose is drawn with N pointing up, which is right only when the view itself points north. It
 * therefore COUNTER-rotates the view: looking east (heading +90°) puts north to the left of the
 * screen, which is a −90° CSS rotation.
 */
export function roseRotationDeg(headingRad: number): number {
  // Normalised again AFTER the negation: `-0` is what negating a north heading produces, and it
  // would ship straight into a `rotate(-0.0deg)` in the style attribute.
  return (normaliseAngle(-normaliseAngle(headingRad)) * 180) / Math.PI;
}

/** True when the view is close enough to north that turning it would be imperceptible. */
export function isFacingNorth(headingRad: number, toleranceRad = 0.02): boolean {
  return Math.abs(normaliseAngle(headingRad)) <= toleranceRad;
}
