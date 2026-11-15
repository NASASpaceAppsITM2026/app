/**
 * NASA WMTS lunar basemap tile selection.
 *
 * Ported from the competition frontend (`ShabuShabu2026/Frontend`,
 * `src/lib/moon-tiles.js`). Given a south-polar viewport bounding box
 * (metres) and a screen width, selects the appropriate LOLA shaded-relief
 * tile pyramid level and computes the visible image tiles.
 */

import { LUNAR_WMTS_LAYERS } from "./data/moon-wmts";
import type { ViewportBox } from "./lunar-projection";

export interface MoonTile {
  readonly key: string;
  readonly url: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface MoonTileLayer {
  readonly name: string;
  readonly tiles: readonly MoonTile[];
}

export function moonTiles(bbox: ViewportBox, screenWidth = 800): MoonTileLayer[] {
  const width = bbox.xmax - bbox.xmin;
  const height = bbox.ymax - bbox.ymin;
  const desired = width / Math.max(1, screenWidth);
  const visible = LUNAR_WMTS_LAYERS.flatMap((layer, index) => {
    // Use the detailed polar coverage only when its resolution is beneficial.
    if (index > 0 && desired > (layer.levels[layer.levels.length - 1]?.resolution ?? 0)) {
      return [];
    }
    const [xmin, ymin, xmax, ymax] = layer.extent;
    // Avoid stitching layers with different illumination across a viewport.
    if (index > 0 && (bbox.xmin < xmin || bbox.xmax > xmax || bbox.ymin < ymin || bbox.ymax > ymax)) {
      return [];
    }
    if (bbox.xmax < xmin || bbox.xmin > xmax || bbox.ymax < ymin || bbox.ymin > ymax) {
      return [];
    }
    const level = layer.levels.find((entry) => entry.resolution <= desired) ?? layer.levels[layer.levels.length - 1];
    const span = level.resolution * 256;
    const [originX, originY] = level.origin;
    const startX = Math.max(0, Math.floor((Math.max(bbox.xmin, xmin) - originX) / span));
    const endX = Math.min(level.columns - 1, Math.floor((Math.min(bbox.xmax, xmax) - originX) / span));
    const startY = Math.max(0, Math.floor((originY - Math.min(bbox.ymax, ymax)) / span));
    const endY = Math.min(level.rows - 1, Math.floor((originY - Math.max(bbox.ymin, ymin)) / span));
    const tiles: MoonTile[] = [];
    for (let row = startY; row <= endY; row += 1) {
      for (let col = startX; col <= endX; col += 1) {
        tiles.push({
          key: `${layer.name}/${level.id}/${row}/${col}`,
          url: `${layer.url}/${level.id}/${row}/${col}.png`,
          left: ((originX + col * span - bbox.xmin) / width) * 100,
          top: ((bbox.ymax - (originY - row * span)) / height) * 100,
          width: (span / width) * 100,
          height: (span / height) * 100,
        });
      }
    }
    return [{ name: layer.name, tiles }];
  });
  return visible.slice(-1);
}
