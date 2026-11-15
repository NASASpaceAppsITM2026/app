/**
 * South-polar viewport math for the lunar map camera.
 *
 * Ported from the competition frontend (`ShabuShabu2026/Frontend`,
 * `src/lib/polar-view.js`). The map only covers the lunar south polar cap
 * (south of ~85°S) and the viewport stays clamped inside that disc.
 */

import { projectSite, type ViewportBox } from "./lunar-projection";

/** Radius of the south-polar map disc (projected metres from the pole). */
export const polarRadius = projectSite(-85, 0).y;

/** True when a site can be drawn on the polar LOLA basemap (~85°S–90°S). */
export function isWithinPolarMap(latDeg: number, eastLonDeg: number): boolean {
  const point = projectSite(latDeg, eastLonDeg);
  return Math.hypot(point.x, point.y) <= polarRadius;
}

/** Full supported polar map extent. */
export const polarExtent: ViewportBox = { xmin: -polarRadius, ymin: -polarRadius, xmax: polarRadius, ymax: polarRadius };

/** Keep the camera viewport inside the supported polar cap. */
export function constrainPolarView(box: ViewportBox): ViewportBox {
  const width = Math.min(2 * polarRadius, Math.max(1000, box.xmax - box.xmin));
  const height = Math.min(2 * polarRadius, Math.max(1000, box.ymax - box.ymin));
  const x = Math.max(-polarRadius + width / 2, Math.min(polarRadius - width / 2, (box.xmin + box.xmax) / 2));
  const y = Math.max(-polarRadius + height / 2, Math.min(polarRadius - height / 2, (box.ymin + box.ymax) / 2));
  return { xmin: x - width / 2, xmax: x + width / 2, ymin: y - height / 2, ymax: y + height / 2 };
}

/** Fit a target viewport into the panel, keeping metres square on screen. */
export function fitPolarViewport(box: ViewportBox, aspect: number = 1): ViewportBox {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const maxWidth = 2 * polarRadius * Math.min(1, ratio);
  const minWidth = Math.min(maxWidth, 1000 * Math.max(1, ratio));
  const width = Math.min(maxWidth, Math.max(minWidth, box.xmax - box.xmin));
  const height = width / ratio;
  const x = (box.xmin + box.xmax) / 2;
  const y = (box.ymin + box.ymax) / 2;
  return constrainPolarView({ xmin: x - width / 2, xmax: x + width / 2, ymin: y - height / 2, ymax: y + height / 2 });
}

/** Start with a rectangle inside the supported polar cap, rather than empty corners. */
export function initialPolarViewport(aspect: number = 1): ViewportBox {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const height = (2 * polarRadius) / Math.sqrt(1 + ratio * ratio);
  const width = height * ratio;
  return { xmin: -width / 2, xmax: width / 2, ymin: -height / 2, ymax: height / 2 };
}
