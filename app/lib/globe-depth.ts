/**
 * Depth cues for the globe: where the Sun is, and which altitude shells the
 * scene draws. Both are pure so the WebGL layer stays free of astronomy.
 */

const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const MS_PER_DAY = 86_400_000;
const DEGREES = Math.PI / 180;

/**
 * Altitude shells that carry the densest operational traffic. The Starlink
 * shells sit near 550 km, the Sun-synchronous Earth-observation corridor runs
 * from roughly 600 to 800 km, and the large polar constellations sit near
 * 1,200 km where drag removes very little.
 */
export const ALTITUDE_SHELLS = [
  { altitudeKm: 550, label: 'Mega-constellation shell', color: '#3f7fa8' },
  { altitudeKm: 800, label: 'Sun-synchronous corridor', color: '#4f8f7a' },
  { altitudeKm: 1200, label: 'Polar constellation shell', color: '#7a6fa8' },
] as const;

export const EARTH_RADIUS_KM = 6_371;

function normalizeDegrees(value: number) {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Geodetic point where the Sun is directly overhead.
 *
 * Low-precision solar position from the NOAA almanac formulation. It stays
 * within about a tenth of a degree for contemporary dates, which is far tighter
 * than a terminator drawn at screen resolution needs.
 */
export function subsolarPoint(date: Date): { lat: number; lng: number } | null {
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  const daysSinceJ2000 = (time - J2000_MS) / MS_PER_DAY;

  const meanLongitude = normalizeDegrees(280.460 + 0.9856474 * daysSinceJ2000);
  const meanAnomaly = normalizeDegrees(357.528 + 0.9856003 * daysSinceJ2000) * DEGREES;
  const eclipticLongitude = (
    meanLongitude
    + 1.915 * Math.sin(meanAnomaly)
    + 0.020 * Math.sin(2 * meanAnomaly)
  ) * DEGREES;
  const obliquity = (23.439 - 0.0000004 * daysSinceJ2000) * DEGREES;

  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude),
  ) / DEGREES;

  const greenwichHourAngle = normalizeDegrees(
    (18.697374558 + 24.06570982441908 * daysSinceJ2000) * 15,
  );
  let longitude = normalizeDegrees(rightAscension - greenwichHourAngle);
  if (longitude > 180) longitude -= 360;

  return { lat: declination / DEGREES, lng: longitude };
}

/** Shell radius in the globe's own units, where the Earth surface is `globeRadius`. */
export function shellRadius(globeRadius: number, altitudeKm: number) {
  return globeRadius * (1 + altitudeKm / EARTH_RADIUS_KM);
}

const SCALE_STEPS_KM = [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 20_000];

/**
 * A rough distance scale for the current camera height.
 *
 * The bar is measured across the middle of the view at the globe surface, so it
 * is only an order-of-magnitude cue: anything nearer the limb sits further from
 * the camera and reads shorter than the bar suggests.
 */
export function scaleBarForView({
  cameraDistance,
  globeRadius,
  verticalFovDegrees,
  viewportHeightPx,
  minimumBarPx = 56,
  maximumBarPx = 150,
}: {
  cameraDistance: number;
  globeRadius: number;
  verticalFovDegrees: number;
  viewportHeightPx: number;
  minimumBarPx?: number;
  maximumBarPx?: number;
}): { km: number; pixels: number } | null {
  if (![cameraDistance, globeRadius, verticalFovDegrees, viewportHeightPx].every(Number.isFinite)) return null;
  if (globeRadius <= 0 || viewportHeightPx <= 0 || verticalFovDegrees <= 0 || verticalFovDegrees >= 180) return null;

  const surfaceDistance = Math.max(cameraDistance - globeRadius, globeRadius * 0.02);
  const visibleHeightUnits = 2 * surfaceDistance * Math.tan(verticalFovDegrees * DEGREES / 2);
  const kilometresPerPixel = (visibleHeightUnits / viewportHeightPx) * (EARTH_RADIUS_KM / globeRadius);
  if (!Number.isFinite(kilometresPerPixel) || kilometresPerPixel <= 0) return null;

  const target = (minimumBarPx + maximumBarPx) / 2;
  let best: { km: number; pixels: number } | null = null;
  let bestPenalty = Infinity;
  for (const km of SCALE_STEPS_KM) {
    const pixels = km / kilometresPerPixel;
    const withinRange = pixels >= minimumBarPx && pixels <= maximumBarPx;
    const penalty = (withinRange ? 0 : 1_000_000) + Math.abs(pixels - target);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      best = { km, pixels: Math.round(pixels) };
    }
  }
  if (!best) return null;
  return { km: best.km, pixels: Math.max(1, Math.min(best.pixels, maximumBarPx * 2)) };
}
