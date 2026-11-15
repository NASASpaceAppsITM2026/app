/**
 * Lunar south-polar stereographic map projection.
 *
 * Ported from the competition frontend (`ShabuShabu2026/Frontend`,
 * `src/lib/projection.js`). The Moon is projected with a south polar
 * stereographic projection: sphere radius R = 1737400 m, central meridian
 * 0°. The south pole sits at the origin of the map coordinate frame and the
 * map's +Y axis (0° longitude) points up-screen.
 */

export const MOON_SURFACE_RADIUS_M = 1737400;

/** Axis-aligned bounding box of the projected map coordinate space (metres). */
export interface ViewportBox {
  readonly xmin: number;
  readonly ymin: number;
  readonly xmax: number;
  readonly ymax: number;
}

export interface LunarMapPoint {
  readonly x: number;
  readonly y: number;
}

export function projectSite(latDeg: number, lonDeg: number): LunarMapPoint {
  const rho = (2 * MOON_SURFACE_RADIUS_M * Math.tan(((90 + latDeg) * Math.PI) / 360));
  return {
    x: rho * Math.sin((lonDeg * Math.PI) / 180),
    y: rho * Math.cos((lonDeg * Math.PI) / 180),
  };
}

export function unprojectSite(x: number, y: number): { latitude: number; longitude: number } {
  const radius = Math.hypot(x, y);
  return {
    latitude: -90 + (2 * Math.atan(radius / (2 * MOON_SURFACE_RADIUS_M)) * 180) / Math.PI,
    longitude: radius ? (Math.atan2(x, y) * 180) / Math.PI : 0,
  };
}

export function globePosition(latitude: number, longitude: number, radius = 1): [number, number, number] {
  const lat = (latitude * Math.PI) / 180;
  const lon = (longitude * Math.PI) / 180;
  return [
    (radius * Math.cos(lat) * Math.cos(lon)) as number,
    (radius * Math.sin(lat)) as number,
    (-radius * Math.cos(lat) * Math.sin(lon)) as number,
  ];
}

/** Flat [x0, y0, z0, x1, y1, z1, ...] outline of the viewport polygon. */
export function viewportOutline(bbox: ViewportBox, steps = 24): number[] {
  const points: number[] = [];
  for (let edge = 0; edge < 4; edge += 1) {
    for (let i = 0; i < steps; i += 1) {
      const t = i / steps;
      const x =
        edge === 0
          ? bbox.xmin + t * (bbox.xmax - bbox.xmin)
          : edge === 1
            ? bbox.xmax
            : edge === 2
              ? bbox.xmax - t * (bbox.xmax - bbox.xmin)
              : bbox.xmin;
      const y = edge === 0 ? bbox.ymax : edge === 1 ? bbox.ymax - t * (bbox.ymax - bbox.ymin) : edge === 2 ? bbox.ymin : bbox.ymin + t * (bbox.ymax - bbox.ymin);
      const { latitude, longitude } = unprojectSite(x, y);
      const p = globePosition(latitude, longitude, 1.012);
      points.push(p[0], p[1], p[2]);
    }
  }
  return points;
}
