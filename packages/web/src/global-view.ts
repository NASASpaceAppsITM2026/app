/**
 * Equirectangular (lon/lat) viewport for landing sites outside the south-polar cap.
 *
 * Polar LOLA tiles only cover ~85°S–90°S. Apollo / Luna sites live at low and
 * mid latitudes, so the site-info map switches to this camera when the
 * selected site is outside that disc.
 */

import { wrapLonDeg } from "./geo";

export interface LonLatBox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

const MIN_LAT_SPAN_DEG = 2;
const MAX_LAT_SPAN_DEG = 80;
/** Mean lunar km per degree of latitude. */
export const MOON_KM_PER_DEG_LAT = 30.32;

export function lonLatSpan(box: LonLatBox): { lon: number; lat: number } {
  return { lon: box.east - box.west, lat: box.north - box.south };
}

export function constrainLonLatView(box: LonLatBox, aspect = 1): LonLatBox {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  let latSpan = Math.min(MAX_LAT_SPAN_DEG, Math.max(MIN_LAT_SPAN_DEG, box.north - box.south));
  let midLat = (box.north + box.south) / 2;
  const cos = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  let lonSpan = (latSpan * ratio) / cos;
  lonSpan = Math.min(360, Math.max(3, lonSpan));
  latSpan = Math.min(MAX_LAT_SPAN_DEG, Math.max(MIN_LAT_SPAN_DEG, (lonSpan * cos) / ratio));
  lonSpan = (latSpan * ratio) / cos;

  let midLon = wrapLonDeg((box.west + box.east) / 2);
  midLat = Math.max(-90 + latSpan / 2, Math.min(90 - latSpan / 2, midLat));

  let west = midLon - lonSpan / 2;
  let east = midLon + lonSpan / 2;
  if (west < -180) {
    east += -180 - west;
    west = -180;
  }
  if (east > 180) {
    west -= east - 180;
    east = 180;
  }

  return {
    west: Math.max(-180, west),
    east: Math.min(180, east),
    south: midLat - latSpan / 2,
    north: midLat + latSpan / 2,
  };
}

/** Frame a landing site with a ~latSpan-degree window, aspect-corrected. */
export function viewportForSite(eastLonDeg: number, latDeg: number, aspect = 1, latSpanDeg = 10): LonLatBox {
  const half = latSpanDeg / 2;
  return constrainLonLatView(
    {
      west: eastLonDeg - 1,
      east: eastLonDeg + 1,
      south: latDeg - half,
      north: latDeg + half,
    },
    aspect,
  );
}

export function lonLatToPercent(eastLonDeg: number, latDeg: number, box: LonLatBox): { x: number; y: number } {
  const { lon, lat } = lonLatSpan(box);
  return {
    x: ((wrapLonDeg(eastLonDeg) - box.west) / lon) * 100,
    y: ((box.north - latDeg) / lat) * 100,
  };
}
