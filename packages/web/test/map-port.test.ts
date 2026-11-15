import { describe, expect, it } from "vitest";
import { projectSite, unprojectSite } from "../src/lunar-projection";
import { polarRadius, fitPolarViewport, initialPolarViewport, constrainPolarView, isWithinPolarMap } from "../src/polar-view";
import { moonTiles } from "../src/moon-tiles";
import { wacTiles, WAC_TILE_URL } from "../src/wac-tiles";
import { lonLatToPercent, viewportForSite } from "../src/global-view";

describe("ported lunar map projection", () => {
  it("projects the south pole to the map origin", () => {
    expect(projectSite(-90, 0).y).toBe(0);
    expect(projectSite(-90, 180).x).toBe(0);
  });

  it("round-trips unproject for a south polar site", () => {
    const point = projectSite(-85, 123.4);
    const back = unprojectSite(point.x, point.y);
    expect(back.latitude).toBeCloseTo(-85, 5);
    expect(back.longitude).toBeCloseTo(123.4, 5);
  });
});

describe("ported polar viewport math", () => {
  it("keeps viewports inside the supported polar cap", () => {
    const clamped = constrainPolarView({ xmin: -1e9, ymin: -1e9, xmax: 1e9, ymax: 1e9 });
    expect(clamped.xmin).toBeGreaterThanOrEqual(-polarRadius);
    expect(clamped.xmax).toBeLessThanOrEqual(polarRadius);
    expect(clamped.ymin).toBeGreaterThanOrEqual(-polarRadius);
    expect(clamped.ymax).toBeLessThanOrEqual(polarRadius);
  });

  it("starts with a viewport inside the polar cap", () => {
    const box = initialPolarViewport(1);
    expect(box.xmax - box.xmin).toBeGreaterThan(0);
    expect(box.xmax).toBeLessThanOrEqual(polarRadius * 2);
    expect(box.ymax - box.ymin).toBeGreaterThan(0);
  });

  it("fits a site-sized viewport around a target point", () => {
    const site = projectSite(-86, 2.7);
    const box = fitPolarViewport({ xmin: site.x - 2000, xmax: site.x + 2000, ymin: site.y - 2000, ymax: site.y + 2000 }, 1);
    expect(box.xmax - box.xmin).toBeGreaterThan(0);
    expect(box.xmax - box.xmin).toBeGreaterThan(0);
    expect(Math.abs(((box.xmin + box.xmax) / 2) - site.x)).toBeLessThan(10);
    expect(Math.abs(((box.ymin + box.ymax) / 2) - site.y)).toBeLessThan(10);
  });
});

describe("ported NASA WMTS moon tiles", () => {
  it("selects visible LOLA shaded-relief tiles for a south polar viewport", () => {
    const layers = moonTiles({ xmin: -50000, ymin: -50000, xmax: 50000, ymax: 50000 }, 800);
    expect(layers.length).toBeGreaterThan(0);
    expect(layers[0].tiles.length).toBeGreaterThan(0);
    for (const tile of layers[0].tiles) {
      expect(tile.url).toContain("https://trek.nasa.gov/tiles/Moon/SP/");
      expect(tile.width).toBeGreaterThan(0);
      expect(tile.height).toBeGreaterThan(0);
    }
  });
});

describe("polar vs global site coverage", () => {
  it("places south-polar candidates on the polar map and Apollo sites on the global map", () => {
    expect(isWithinPolarMap(-89.9, 120)).toBe(true);
    expect(isWithinPolarMap(-86, 2.7)).toBe(true);
    expect(isWithinPolarMap(0.674, 23.45)).toBe(false);
    expect(isWithinPolarMap(26.44, 3.72)).toBe(false);
  });
});

describe("global WAC mosaic tiles", () => {
  it("selects Trek WAC tiles around Apollo 11", () => {
    const box = viewportForSite(23.45, 0.674, 1, 10);
    const tiles = wacTiles(box, 400);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles[0].url.startsWith(WAC_TILE_URL)).toBe(true);
    const pct = lonLatToPercent(23.45, 0.674, box);
    expect(pct.x).toBeGreaterThan(40);
    expect(pct.x).toBeLessThan(60);
    expect(pct.y).toBeGreaterThan(40);
    expect(pct.y).toBeLessThan(60);
  });
});
