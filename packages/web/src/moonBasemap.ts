/**
 * NASA WMTS lunar basemap renderer.
 *
 * Ported from the competition frontend (`ShabuShabu2026/Frontend`,
 * `src/components/MoonBasemap.jsx`): paints the currently visible tile layer
 * into a container element, absolutely positioning each image tile.
 */

import { moonTiles } from "./moon-tiles";
import type { ViewportBox } from "./lunar-projection";

export function renderMoonBasemap(container: HTMLElement, bbox: ViewportBox, screenWidth: number): void {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  const layers = moonTiles(bbox, Math.max(1, screenWidth));
  for (const layer of layers) {
    const layerEl = document.createElement("div");
    layerEl.className = "nasa-tile-layer";
    layerEl.setAttribute("data-layer", layer.name);
    for (const tile of layer.tiles) {
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
}
