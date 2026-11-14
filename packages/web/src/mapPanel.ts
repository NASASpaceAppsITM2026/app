import type { LunarSite } from "core";
import {
  lonLatToEquirectUv,
  lonLatToSouthPolar,
  equirectUvToLonLat,
  southPolarToLonLat,
} from "./geo";
import { PRESET_SITES, siteLabel } from "./scenario";

const MOON_MAP_URL = "/textures/moon.jpg";
const POLAR_LAT_MIN = -80;

let moonImage: HTMLImageElement | null = null;
let moonImagePromise: Promise<HTMLImageElement> | null = null;

export function loadMoonMapImage(): Promise<HTMLImageElement> {
  if (moonImage) return Promise.resolve(moonImage);
  if (moonImagePromise) return moonImagePromise;
  moonImagePromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      moonImage = img;
      resolve(img);
    };
    img.onerror = () => reject(new Error("Failed to load bundled lunar map texture"));
    img.src = MOON_MAP_URL;
  });
  return moonImagePromise;
}

export interface MapPanelHandles {
  readonly global: HTMLCanvasElement;
  readonly polar: HTMLCanvasElement;
}

export interface MapDrawOptions {
  readonly site: LunarSite;
  readonly ellipseRadiusKm?: number;
}

export function drawMaps(handles: MapPanelHandles, site: LunarSite, ellipseRadiusKm?: number): void {
  if (!moonImage) return;
  drawGlobalMap(handles.global, moonImage, site, ellipseRadiusKm);
  drawPolarMap(handles.polar, moonImage, site, ellipseRadiusKm);
}

export function bindMapClicks(
  handles: MapPanelHandles,
  onPick: (eastLonDeg: number, latDeg: number) => void,
): void {
  handles.global.addEventListener("click", (event) => {
    const uv = canvasUv(handles.global, event);
    if (!uv) return;
    const { eastLonDeg, latDeg } = equirectUvToLonLat(uv.u, uv.v);
    onPick(eastLonDeg, latDeg);
  });
  handles.polar.addEventListener("click", (event) => {
    const uv = canvasUv(handles.polar, event);
    if (!uv) return;
    const loc = southPolarToLonLat(uv.u, uv.v, POLAR_LAT_MIN);
    if (!loc) return;
    onPick(loc.eastLonDeg, loc.latDeg);
  });
}

function canvasUv(canvas: HTMLCanvasElement, event: MouseEvent): { u: number; v: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    u: (event.clientX - rect.left) / rect.width,
    v: (event.clientY - rect.top) / rect.height,
  };
}

function drawGlobalMap(canvas: HTMLCanvasElement, image: HTMLImageElement, site: LunarSite, ellipseRadiusKm?: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  fitCanvas(canvas);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(247,247,248,0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();

  // Draw landing ellipse if requested
  if (ellipseRadiusKm != null && ellipseRadiusKm > 0) {
    drawEllipse(ctx, canvas.width, canvas.height, site.eastLonDeg, site.latDeg, ellipseRadiusKm);
  }

  for (const preset of PRESET_SITES) {
    const uv = lonLatToEquirectUv(preset.eastLonDeg, preset.latDeg);
    drawMarker(ctx, uv.u * canvas.width, uv.v * canvas.height, preset.id === site.id);
  }
  const uv = lonLatToEquirectUv(site.eastLonDeg, site.latDeg);
  drawMarker(ctx, uv.u * canvas.width, uv.v * canvas.height, true);
}

function drawEllipse(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  centerLon: number,
  centerLat: number,
  radiusKm: number,
): void {
  // Convert km to degrees
  const kmPerDegLat = 29.7;
  const kmPerDegLon = 29.7 * Math.cos((centerLat * Math.PI) / 180);
  const dLatDeg = radiusKm / kmPerDegLat;
  const dLonDeg = kmPerDegLon > 0.1 ? radiusKm / kmPerDegLon : dLatDeg * 2;

  const centerUv = lonLatToEquirectUv(centerLon, centerLat);
  const edgeUv = lonLatToEquirectUv(centerLon + dLonDeg, centerLat + dLatDeg);

  const rx = Math.abs(edgeUv.u - centerUv.u) * width;
  const ry = Math.abs(edgeUv.v - centerUv.v) * height;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(centerUv.u * width, centerUv.v * height, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(245,158,11,0.7)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.fillStyle = "rgba(245,158,11,0.08)";
  ctx.fill();
  ctx.restore();
}

const polarCache = new Map<string, HTMLCanvasElement>();

function polarKey(width: number, height: number): string {
  return `${width}x${height}`;
}

function polarTerrain(image: HTMLImageElement, width: number, height: number): HTMLCanvasElement {
  const key = polarKey(width, height);
  const cached = polarCache.get(key);
  if (cached) return cached;

  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const ctx = off.getContext("2d");
  if (!ctx) return off;
  const imageData = ctx.createImageData(width, height);
  const src = sampleSource(image);
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const loc = southPolarToLonLat(px / width, py / height, POLAR_LAT_MIN);
      const i = (py * width + px) * 4;
      if (!loc) {
        imageData.data[i + 3] = 0;
        continue;
      }
      const uv = lonLatToEquirectUv(loc.eastLonDeg, loc.latDeg);
      const color = sampleUv(src, uv.u, uv.v);
      imageData.data[i] = color[0];
      imageData.data[i + 1] = color[1];
      imageData.data[i + 2] = color[2];
      imageData.data[i + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  polarCache.set(key, off);
  return off;
}

function drawPolarMap(canvas: HTMLCanvasElement, image: HTMLImageElement, site: LunarSite, ellipseRadiusKm?: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  fitCanvas(canvas);
  const { width, height } = canvas;
  const radius = Math.min(width, height) / 2 - 2;
  const cx = width / 2;
  const cy = height / 2;

  ctx.fillStyle = "#0f0e13";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(polarTerrain(image, width, height), 0, 0);
  ctx.restore();
  ctx.strokeStyle = "#a1a1aa";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Draw landing ellipse if requested and site is in polar region
  if (ellipseRadiusKm != null && ellipseRadiusKm > 0 && site.latDeg <= POLAR_LAT_MIN) {
    drawPolarEllipse(ctx, width, height, site.eastLonDeg, site.latDeg, ellipseRadiusKm);
  }

  for (const preset of PRESET_SITES) {
    const polar = lonLatToSouthPolar(preset.eastLonDeg, preset.latDeg, POLAR_LAT_MIN);
    if (!polar) continue;
    drawMarker(ctx, polar.x * width, polar.y * height, preset.id === site.id);
  }
  const selected = lonLatToSouthPolar(site.eastLonDeg, site.latDeg, POLAR_LAT_MIN);
  if (selected) {
    drawMarker(ctx, selected.x * width, selected.y * height, true);
  }
}

function drawPolarEllipse(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  centerLon: number,
  centerLat: number,
  radiusKm: number,
): void {
  const kmPerDegLat = 29.7;
  const dLatDeg = radiusKm / kmPerDegLat;

  const center = lonLatToSouthPolar(centerLon, centerLat, POLAR_LAT_MIN);
  const edge = lonLatToSouthPolar(centerLon, centerLat - dLatDeg, POLAR_LAT_MIN);
  if (!center || !edge) return;

  const r = Math.abs(edge.y - center.y) * height;

  ctx.save();
  ctx.beginPath();
  ctx.arc(center.x * width, center.y * height, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(245,158,11,0.7)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.fillStyle = "rgba(245,158,11,0.08)";
  ctx.fill();
  ctx.restore();
}

function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, selected: boolean): void {
  ctx.beginPath();
  ctx.arc(x, y, selected ? 5 : 3, 0, Math.PI * 2);
  ctx.fillStyle = selected ? "#f59e0b" : "#3b82f6";
  ctx.fill();
  ctx.strokeStyle = "#f7f7f8";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function fitCanvas(canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}

interface SourceImage {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

const sourceCache = new WeakMap<HTMLImageElement, SourceImage>();

function sampleSource(image: HTMLImageElement): SourceImage {
  const cached = sourceCache.get(image);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read lunar map pixels");
  ctx.drawImage(image, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const src = { data, width, height };
  sourceCache.set(image, src);
  return src;
}

function sampleUv(src: SourceImage, u: number, v: number): [number, number, number] {
  const x = Math.min(src.width - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * src.width)));
  const y = Math.min(src.height - 1, Math.max(0, Math.floor(Math.min(1, Math.max(0, v)) * src.height)));
  const i = (y * src.width + x) * 4;
  return [src.data[i], src.data[i + 1], src.data[i + 2]];
}

export function nearestPreset(eastLonDeg: number, latDeg: number, maxDeg = 0.4): LunarSite | null {
  let best: LunarSite | null = null;
  let bestDist = maxDeg;
  for (const site of PRESET_SITES) {
    const dlat = site.latDeg - latDeg;
    const dlon = Math.min(
      Math.abs(site.eastLonDeg - eastLonDeg),
      360 - Math.abs(site.eastLonDeg - eastLonDeg),
    ) * Math.cos((latDeg * Math.PI) / 180);
    const dist = Math.hypot(dlat, dlon);
    if (dist < bestDist) {
      best = site;
      bestDist = dist;
    }
  }
  return best;
}

export { siteLabel };
