/**
 * Lunar map controller — NASA WMTS basemap + polar viewport camera.
 *
 * Ported from the competition frontend (`ShabuShabu2026/Frontend`,
 * `src/components/LunarMap.jsx`). Renders the LOLA shaded-relief basemap for a
 * south-polar viewport bounding box, supports pan/zoom, fits the viewport to a
 * selected landing site, and overlays landing-site markers.
 */

import { projectSite, type ViewportBox } from "./lunar-projection";
import { polarRadius, polarExtent, fitPolarViewport, initialPolarViewport, isWithinPolarMap } from "./polar-view";
import { constrainLonLatView, lonLatToPercent, viewportForSite, MOON_KM_PER_DEG_LAT, type LonLatBox } from "./global-view";
import { renderGlobalBasemap, renderMoonBasemap } from "./moonBasemap";
import { createMoonLocator, type MoonLocatorHandle } from "./moonLocator";
import type { LunarSite } from "core";
import { siteLabel } from "./scenario";

export interface LunarMapHandle {
  /** The `.lunar-map` root element this controller rendered into the host. */
  readonly element: HTMLElement;
  readonly locator: MoonLocatorHandle | null;
  /** Animate the viewport to frame the given landing site. */
  fitToSite(site: LunarSite): void;
  /** Animate the viewport back to the default polar view. */
  reset(): void;
  /** Release listeners / animation state. */
  readonly dispose: () => void;
}

export interface LunarMapOptions {
  readonly container: HTMLElement;
  readonly selected: LunarSite;
  readonly nearbySites?: readonly LunarSite[];
  readonly ellipseRadiusKm?: number;
  readonly onSelect?: (site: LunarSite) => void;
  /** Strip globe inset, pan buttons, and large callouts for a small panel. */
  readonly compact?: boolean;
}

const CAMERA_ANIMATION_MS = 650;

export function createLunarMap(options: LunarMapOptions): LunarMapHandle {
  const container = options.container;
  const selected = options.selected;
  const nearbySites = options.nearbySites ?? [];
  const ellipseRadiusKm = options.ellipseRadiusKm ?? 0;
  const onSelect = options.onSelect;
  const compact = options.compact ?? true;
  const polarMode = isWithinPolarMap(selected.latDeg, selected.eastLonDeg);

  // ── Map shell (ported DOM structure) ──
  const root = document.createElement("div");
  root.className = ["lunar-map", compact ? "is-compact" : "", polarMode ? "" : "is-global"].filter(Boolean).join(" ");

  const surface = document.createElement("div");
  surface.className = "projected-map";
  root.appendChild(surface);

  const coverage = document.createElement("div");
  coverage.className = "polar-map-coverage";
  surface.appendChild(coverage);

  const annotationsEl = document.createElement("div");
  annotationsEl.className = "map-annotations";
  surface.appendChild(annotationsEl);

  const ellipseSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ellipseSvg.setAttribute("class", "map-ellipse-overlay");
  ellipseSvg.setAttribute("preserveAspectRatio", "none");
  surface.appendChild(ellipseSvg);
  const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
  ellipseSvg.appendChild(ellipse);

  let locator: MoonLocatorHandle | null = null;
  if (!compact) {
    const locatorRoot = document.createElement("aside");
    locatorRoot.className = "moon-locator";
    const locatorTitle = document.createElement("div");
    locatorTitle.className = "locator-title";
    locatorTitle.appendChild(document.createTextNode("Moon overview"));
    const locatorTitleBadge = document.createElement("span");
    locatorTitleBadge.textContent = "3D";
    locatorTitle.appendChild(locatorTitleBadge);
    const globeHost = document.createElement("div");
    globeHost.className = "locator-globe";
    locator = createMoonLocator(globeHost);
    const locatorCaption = document.createElement("div");
    locatorCaption.className = "locator-caption";
    locatorCaption.appendChild(document.createElement("i"));
    locatorCaption.appendChild(document.createTextNode("Current view"));
    const locatorSmall = document.createElement("small");
    locatorSmall.textContent = "";
    locatorRoot.appendChild(locatorTitle);
    locatorRoot.appendChild(globeHost);
    locatorRoot.appendChild(locatorCaption);
    locatorRoot.appendChild(locatorSmall);
    root.appendChild(locatorRoot);
  }

  const controls = document.createElement("div");
  controls.className = "map-controls";
  const makeControl = (label: string, ariaLabel: string, onClick: () => void): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", ariaLabel);
    button.addEventListener("click", onClick);
    controls.appendChild(button);
    return button;
  };
  makeControl("+", "Zoom in", () => zoom(0.5));
  makeControl("−", "Zoom out", () => zoom(2));
  if (!compact) {
    makeControl("←", "Pan west", () => zoom(1, -0.25));
    makeControl("→", "Pan east", () => zoom(1, 0.25));
    makeControl("↑", "Pan north", () => zoom(1, 0, 0.25));
    makeControl("↓", "Pan south", () => zoom(1, 0, -0.25));
  }
  makeControl(compact ? "↺" : "Reset view", "Reset lunar map view", () => reset());
  root.appendChild(controls);

  const legend = document.createElement("p");
  legend.className = "map-legend";
  legend.innerHTML = polarMode
    ? compact
      ? "<span>LOLA DEM · drag / scroll</span>"
      : "NASA / LRO LOLA DEM · 85°S–90°S<br /><span>Drag to pan · Scroll to zoom</span>"
    : compact
      ? "<span>LRO WAC mosaic · drag / scroll</span>"
      : "NASA / LRO WAC global mosaic<br /><span>Drag to pan · Scroll to zoom</span>";
  root.appendChild(legend);

  ellipse.setAttribute("fill", "rgba(245, 158, 11, 0.14)");
  ellipse.setAttribute("stroke", "#f59e0b");
  ellipse.setAttribute("stroke-width", "2");

  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  container.appendChild(root);

  // ── Viewport state ──
  let aspect = 1;
  const measure = (): void => {
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) aspect = rect.width / rect.height;
  };
  measure();
  const resizeObserver = new ResizeObserver(measure);
  resizeObserver.observe(container);

  let currentBox: ViewportBox = initialPolarViewport(aspect);
  let currentLonLat: LonLatBox = viewportForSite(selected.eastLonDeg, selected.latDeg, aspect, 12);
  let animationId: number | null = null;

  const setPolarViewport = (next: ViewportBox | null): void => {
    const box = next ? fitPolarViewport(next, aspect) : null;
    currentBox = box ?? initialPolarViewport(aspect);
    render();
  };

  const setGlobalViewport = (next: LonLatBox): void => {
    currentLonLat = constrainLonLatView(next, aspect);
    render();
  };

  const cancelAnimation = (): void => {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  };

  const movePolarCamera = (target: ViewportBox, animate = false): void => {
    const fitted = fitPolarViewport(target, aspect);
    cancelAnimation();
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPolarViewport(fitted);
      return;
    }
    const initial = currentBox;
    const start = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / CAMERA_ANIMATION_MS);
      const eased = 1 - (1 - progress) ** 3;
      const next = Object.fromEntries(
        (Object.keys(fitted) as Array<keyof ViewportBox>).map((key) => [
          key,
          initial[key] + (fitted[key] - initial[key]) * eased,
        ]),
      ) as unknown as ViewportBox;
      setPolarViewport(next);
      if (progress < 1) animationId = requestAnimationFrame(step);
    };
    animationId = requestAnimationFrame(step);
  };

  const moveGlobalCamera = (target: LonLatBox, animate = false): void => {
    const fitted = constrainLonLatView(target, aspect);
    cancelAnimation();
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setGlobalViewport(fitted);
      return;
    }
    const initial = currentLonLat;
    const start = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / CAMERA_ANIMATION_MS);
      const eased = 1 - (1 - progress) ** 3;
      setGlobalViewport({
        west: initial.west + (fitted.west - initial.west) * eased,
        east: initial.east + (fitted.east - initial.east) * eased,
        south: initial.south + (fitted.south - initial.south) * eased,
        north: initial.north + (fitted.north - initial.north) * eased,
      });
      if (progress < 1) animationId = requestAnimationFrame(step);
    };
    animationId = requestAnimationFrame(step);
  };

  // ── Camera actions ──
  function zoom(factor: number, dx = 0, dy = 0): void {
    if (polarMode) {
      const box = currentBox;
      const width = Math.max(1000, Math.min(2 * polarRadius, (box.xmax - box.xmin) * factor));
      const height = (width * (box.ymax - box.ymin)) / (box.xmax - box.xmin);
      const x = (box.xmin + box.xmax) / 2;
      const y = (box.ymin + box.ymax) / 2;
      movePolarCamera(
        {
          xmin: x - width / 2 + dx * width,
          xmax: x + width / 2 + dx * width,
          ymin: y - height / 2 + dy * height,
          ymax: y + height / 2 + dy * height,
        },
        true,
      );
      return;
    }
    const box = currentLonLat;
    const latSpan = (box.north - box.south) * factor;
    const lonSpan = (box.east - box.west) * factor;
    const lon = (box.west + box.east) / 2 + dx * lonSpan;
    const lat = (box.south + box.north) / 2 + dy * latSpan;
    moveGlobalCamera(
      { west: lon - lonSpan / 2, east: lon + lonSpan / 2, south: lat - latSpan / 2, north: lat + latSpan / 2 },
      true,
    );
  }

  function reset(): void {
    if (polarMode) {
      movePolarCamera(initialPolarViewport(aspect), true);
      return;
    }
    moveGlobalCamera(viewportForSite(selected.eastLonDeg, selected.latDeg, aspect, 28), true);
  }

  function fitToSite(site: LunarSite): void {
    if (polarMode) {
      const point = projectSite(site.latDeg, site.eastLonDeg);
      const width = Math.max(4000, (polarExtent.xmax - polarExtent.xmin) / 6);
      const height = width / aspect;
      movePolarCamera({ xmin: point.x - width / 2, xmax: point.x + width / 2, ymin: point.y - height / 2, ymax: point.y + height / 2 }, true);
      return;
    }
    moveGlobalCamera(viewportForSite(site.eastLonDeg, site.latDeg, aspect, 10), true);
  }

  // ── Interaction: wheel zoom, drag pan ──
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    cancelAnimation();
    const rect = surface.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    const scale = Math.exp(event.deltaY * 0.0015);
    if (polarMode) {
      const box = currentBox;
      const width = Math.max(1000, Math.min(2 * polarRadius, (box.xmax - box.xmin) * scale));
      const height = (width * (box.ymax - box.ymin)) / (box.xmax - box.xmin);
      const x = box.xmin + fx * (box.xmax - box.xmin);
      const y = box.ymax - fy * (box.ymax - box.ymin);
      setPolarViewport({ xmin: x - fx * width, xmax: x + (1 - fx) * width, ymin: y - (1 - fy) * height, ymax: y + fy * height });
      return;
    }
    const box = currentLonLat;
    const lonSpan = (box.east - box.west) * scale;
    const latSpan = (box.north - box.south) * scale;
    const lon = box.west + fx * (box.east - box.west);
    const lat = box.north - fy * (box.north - box.south);
    setGlobalViewport({
      west: lon - fx * lonSpan,
      east: lon + (1 - fx) * lonSpan,
      south: lat - (1 - fy) * latSpan,
      north: lat + fy * latSpan,
    });
  };
  surface.addEventListener("wheel", onWheel, { passive: false });

  let dragState: { x: number; y: number; polar?: ViewportBox; global?: LonLatBox } | null = null;
  const onPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Element && event.target.closest("button")) return;
    if (event.button !== 0) return;
    cancelAnimation();
    dragState = polarMode
      ? { x: event.clientX, y: event.clientY, polar: currentBox }
      : { x: event.clientX, y: event.clientY, global: currentLonLat };
    surface.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragState) return;
    const rect = surface.getBoundingClientRect();
    if (polarMode && dragState.polar) {
      const dx = ((event.clientX - dragState.x) / rect.width) * (dragState.polar.xmax - dragState.polar.xmin);
      const dy = ((event.clientY - dragState.y) / rect.height) * (dragState.polar.ymax - dragState.polar.ymin);
      setPolarViewport({ xmin: dragState.polar.xmin - dx, xmax: dragState.polar.xmax - dx, ymin: dragState.polar.ymin + dy, ymax: dragState.polar.ymax + dy });
      return;
    }
    if (dragState.global) {
      const dx = ((event.clientX - dragState.x) / rect.width) * (dragState.global.east - dragState.global.west);
      const dy = ((event.clientY - dragState.y) / rect.height) * (dragState.global.north - dragState.global.south);
      setGlobalViewport({
        west: dragState.global.west - dx,
        east: dragState.global.east - dx,
        south: dragState.global.south + dy,
        north: dragState.global.north + dy,
      });
    }
  };
  const endDrag = (): void => {
    dragState = null;
  };
  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointermove", onPointerMove);
  surface.addEventListener("pointerup", endDrag);
  surface.addEventListener("pointercancel", endDrag);

  // ── Rendering ──
  const render = (): void => {
    const widthPx = surface.clientWidth || 800;
    if (polarMode) {
      renderMoonBasemap(coverage, currentBox, widthPx);
    } else {
      renderGlobalBasemap(coverage, currentLonLat, widthPx);
    }

    while (annotationsEl.firstChild) {
      annotationsEl.removeChild(annotationsEl.firstChild);
    }
    const markers: readonly LunarSite[] = [selected, ...nearbySites.filter((n) => n.id !== selected.id)];
    for (const marker of markers) {
      let x: number;
      let y: number;
      if (polarMode) {
        if (!isWithinPolarMap(marker.latDeg, marker.eastLonDeg)) continue;
        const point = projectSite(marker.latDeg, marker.eastLonDeg);
        x = ((point.x - currentBox.xmin) / (currentBox.xmax - currentBox.xmin)) * 100;
        y = ((currentBox.ymax - point.y) / (currentBox.ymax - currentBox.ymin)) * 100;
      } else {
        const pct = lonLatToPercent(marker.eastLonDeg, marker.latDeg, currentLonLat);
        x = pct.x;
        y = pct.y;
      }
      if (x < 0 || x > 100 || y < 0 || y > 100) continue;

      const annotation = document.createElement("div");
      const isSelected = marker.id === selected.id;
      annotation.className = `map-annotation${isSelected ? " is-selected" : ""}`;
      annotation.style.left = `${x}%`;
      annotation.style.top = `${y}%`;

      const label = siteLabel(marker.id);
      if (!compact || isSelected) {
        const callout = document.createElement("button");
        callout.type = "button";
        callout.className = "spot-callout";
        callout.setAttribute("aria-label", `View ${label}`);
        callout.innerHTML = compact
          ? `<strong>${label}</strong>`
          : `<strong>${label}</strong><span class="spot-summary"><span>${isSelected ? "Landing site" : "Candidate"}</span></span>`;
        callout.addEventListener("click", () => onSelect?.(marker));
        annotation.appendChild(callout);
      }

      const markerBtn = document.createElement("button");
      markerBtn.type = "button";
      markerBtn.className = "spot-marker";
      markerBtn.title = label;
      markerBtn.setAttribute("aria-label", `Select ${label}`);
      markerBtn.addEventListener("click", () => onSelect?.(marker));
      annotation.appendChild(markerBtn);
      annotationsEl.appendChild(annotation);
    }

    const rect = surface.getBoundingClientRect();
    const pixelWidth = Math.max(1, rect.width);
    const pixelHeight = Math.max(1, rect.height);
    if (polarMode) {
      const widthM = currentBox.xmax - currentBox.xmin;
      const heightM = currentBox.ymax - currentBox.ymin;
      const center = projectSite(selected.latDeg, selected.eastLonDeg);
      ellipse.setAttribute("cx", String(((center.x - currentBox.xmin) / widthM) * pixelWidth));
      ellipse.setAttribute("cy", String(((currentBox.ymax - center.y) / heightM) * pixelHeight));
      ellipse.setAttribute("rx", String(((ellipseRadiusKm * 1000) / widthM) * pixelWidth));
      ellipse.setAttribute("ry", String(((ellipseRadiusKm * 1000) / heightM) * pixelHeight));
      locator?.update(currentBox);
    } else {
      const pct = lonLatToPercent(selected.eastLonDeg, selected.latDeg, currentLonLat);
      const lonSpan = currentLonLat.east - currentLonLat.west;
      const latSpan = currentLonLat.north - currentLonLat.south;
      const kmPerDegLon = MOON_KM_PER_DEG_LAT * Math.max(0.2, Math.cos((selected.latDeg * Math.PI) / 180));
      ellipse.setAttribute("cx", String((pct.x / 100) * pixelWidth));
      ellipse.setAttribute("cy", String((pct.y / 100) * pixelHeight));
      ellipse.setAttribute("rx", String((ellipseRadiusKm / (lonSpan * kmPerDegLon)) * pixelWidth));
      ellipse.setAttribute("ry", String((ellipseRadiusKm / (latSpan * MOON_KM_PER_DEG_LAT)) * pixelHeight));
    }
  };
  render();

  return {
    element: root,
    locator,
    fitToSite,
    reset,
    dispose: (): void => {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
      resizeObserver.disconnect();
    },
  };
}
