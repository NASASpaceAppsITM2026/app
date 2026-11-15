/**
 * NASA WMTS lunar basemap renderer.
 *
 * Ported from the competition frontend (`ShabuShabu2026/Frontend`,
 * `src/components/MoonBasemap.jsx`): paints the currently visible tile layer
 * into a container element, absolutely positioning each image tile.
 */

import { moonTiles, type MoonTile } from "./moon-tiles";
import { wacTiles } from "./wac-tiles";
import type { LonLatBox } from "./global-view";
import type { ViewportBox } from "./lunar-projection";

function paintTiles(container: HTMLElement, layerName: string, tiles: readonly MoonTile[]): void {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  const layerEl = document.createElement("div");
  layerEl.className = "nasa-tile-layer";
  layerEl.setAttribute("data-layer", layerName);
  for (const tile of tiles) {
    const img = document.createElement("img");
    img.src = tile.url;
    img.alt = "";
    img.draggable = false;
    img.className = "nasa-moon-tile";
    img.style.left = `${tile.left}%`;
    img.style.top = `${tile.top}%`;
    img.style.width = `calc(${tile.width}% + 0.75px)`;
    img.style.height = `calc(${tile.height}% + 0.75px)`;
    img.addEventListener("error", () => {
      img.style.visibility = "hidden";
    });
    layerEl.appendChild(img);
  }
  container.appendChild(layerEl);
}

export function renderMoonBasemap(container: HTMLElement, bbox: ViewportBox, screenWidth: number): void {
  const layers = moonTiles(bbox, Math.max(1, screenWidth));
  paintTiles(container, layers[0]?.name ?? "polar", layers[0]?.tiles ?? []);
}

export function renderGlobalBasemap(container: HTMLElement, bbox: LonLatBox, screenWidth: number): void {
  paintTiles(container, "LRO_WAC_Mosaic_Global", wacTiles(bbox, Math.max(1, screenWidth)));
}
