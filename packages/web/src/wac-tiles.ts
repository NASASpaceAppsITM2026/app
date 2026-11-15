/**
 * NASA Trek LRO WAC global mosaic tiles (equirectangular).
 *
 * Layer: LRO_WAC_Mosaic_Global_303ppd_v02
 * Grid: level z has 2^(z+1) columns × 2^z rows of 256px JPEG tiles,
 * origin at lon −180° / lat +90°.
 */

import type { MoonTile } from "./moon-tiles";
import type { LonLatBox } from "./global-view";

export const WAC_TILE_URL =
  "https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm";

const TILE_PX = 256;
const MAX_LEVEL = 8;

export function wacTiles(box: LonLatBox, screenWidth = 800): MoonTile[] {
  const lonSpan = Math.max(1e-6, box.east - box.west);
  const latSpan = Math.max(1e-6, box.north - box.south);
  const desired = lonSpan / Math.max(1, screenWidth);

  let z = 0;
  for (let i = 0; i <= MAX_LEVEL; i += 1) {
    z = i;
    const res = 360 / (2 ** (i + 1) * TILE_PX);
    if (res <= desired) break;
  }

  const columns = 2 ** (z + 1);
  const rows = 2 ** z;
  const tileLon = 360 / columns;
  const tileLat = 180 / rows;

  const startX = Math.max(0, Math.floor((box.west + 180) / tileLon));
  const endX = Math.min(columns - 1, Math.floor((box.east + 180) / tileLon));
  const startY = Math.max(0, Math.floor((90 - box.north) / tileLat));
  const endY = Math.min(rows - 1, Math.floor((90 - box.south) / tileLat));

  const tiles: MoonTile[] = [];
  for (let row = startY; row <= endY; row += 1) {
    for (let col = startX; col <= endX; col += 1) {
      const tileWest = -180 + col * tileLon;
      const tileNorth = 90 - row * tileLat;
      tiles.push({
        key: `wac/${z}/${row}/${col}`,
        url: `${WAC_TILE_URL}/${z}/${row}/${col}.jpg`,
        left: ((tileWest - box.west) / lonSpan) * 100,
        top: ((box.north - tileNorth) / latSpan) * 100,
        width: (tileLon / lonSpan) * 100,
        height: (tileLat / latSpan) * 100,
      });
    }
  }
  return tiles;
}
