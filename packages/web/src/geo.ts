/**
 * Selenographic ↔ scene / map conversions.
 *
 * Matches Three.js SphereGeometry UVs (Y-up, u=0 at east longitude 180°)
 * and the core East-North-Up convention: x = cos(lat)cos(lon),
 * y = sin(lat), z = cos(lat)sin(lon).
 */

export interface LonLat {
  readonly eastLonDeg: number;
  readonly latDeg: number;
}

export interface Uv {
  readonly u: number;
  readonly v: number;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Wrap longitude to (−180, 180]. */
export function wrapLonDeg(eastLonDeg: number): number {
  const wrapped = ((((eastLonDeg + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** Equirectangular UV for a NASA-style map with longitude 0 at the image center. */
export function lonLatToEquirectUv(eastLonDeg: number, latDeg: number): Uv {
  const lon = wrapLonDeg(eastLonDeg);
  return {
    u: (lon + 180) / 360,
    v: (90 - latDeg) / 180,
  };
}

export function equirectUvToLonLat(u: number, v: number): LonLat {
  return {
    eastLonDeg: wrapLonDeg(u * 360 - 180),
    latDeg: 90 - v * 180,
  };
}

/** Convert a direction (or surface point) in Y-up Moon-centered coordinates to lon/lat. */
export function cartesianToLonLat(x: number, y: number, z: number): LonLat {
  const r = Math.hypot(x, y, z);
  if (r === 0) {
    return { eastLonDeg: 0, latDeg: 0 };
  }
  return {
    eastLonDeg: wrapLonDeg(Math.atan2(z, x) * RAD_TO_DEG),
    latDeg: Math.asin(y / r) * RAD_TO_DEG,
  };
}

export function lonLatToCartesian(
  eastLonDeg: number,
  latDeg: number,
  radius: number,
): { x: number; y: number; z: number } {
  const lat = latDeg * DEG_TO_RAD;
  const lon = eastLonDeg * DEG_TO_RAD;
  const cosLat = Math.cos(lat);
  return {
    x: radius * cosLat * Math.cos(lon),
    y: radius * Math.sin(lat),
    z: radius * cosLat * Math.sin(lon),
  };
}

/**
 * South-polar stereographic-style inset, pole at center, 0°E toward the top.
 * `latMinDeg` is the outer latitude ring (e.g. −80).
 * Returns null when the point is north of that ring.
 */
export function lonLatToSouthPolar(
  eastLonDeg: number,
  latDeg: number,
  latMinDeg = -80,
): { x: number; y: number } | null {
  if (latDeg > latMinDeg) return null;
  const span = 90 + latMinDeg;
  const rho = (90 + latDeg) / span;
  const lon = eastLonDeg * DEG_TO_RAD;
  return {
    x: 0.5 + 0.5 * rho * Math.sin(lon),
    y: 0.5 - 0.5 * rho * Math.cos(lon),
  };
}

export function southPolarToLonLat(
  x: number,
  y: number,
  latMinDeg = -80,
): LonLat | null {
  const dx = (x - 0.5) * 2;
  const dy = (y - 0.5) * 2;
  const rho = Math.hypot(dx, dy);
  if (rho > 1) return null;
  const span = 90 + latMinDeg;
  return {
    eastLonDeg: wrapLonDeg(Math.atan2(dx, -dy) * RAD_TO_DEG),
    latDeg: -90 + rho * span,
  };
}

/** Apparent disc angular radius in degrees from distance and body radius. */
export function angularRadiusDeg(distanceKm: number, radiusKm: number): number {
  if (distanceKm <= 0) {
    throw new Error(`distanceKm must be positive, got ${String(distanceKm)}`);
  }
  return Math.asin(Math.min(1, radiusKm / distanceKm)) * RAD_TO_DEG;
}
