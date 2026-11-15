/**
 * Lunar map controller — NASA WMTS basemap + polar viewport camera.
 *
 * Ported from the competition frontend (`ShabuShabu2026/Frontend`,
 * `src/components/LunarMap.jsx`). Renders the LOLA shaded-relief basemap for a
 * south-polar viewport bounding box, supports pan/zoom, fits the viewport to a
 * selected landing site, and overlays landing-site markers.
 */

import { projectSite, type ViewportBox } from "./lunar-projection";
import { polarRadius, polarExtent, fitPolarViewport, initialPolarViewport } from "./polar-view";
import { renderMoonBasemap } from "./moonBasemap";
import { createMoonLocator, type MoonLocatorHandle } from "./moonLocator";
import type { LunarSite } from "core";

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
}

const CAMERA_ANIMATION_MS = 650;

export function createLunarMap(options: LunarMapOptions): LunarMapHandle {
  const container = options.container;
  const selected = options.selected;
  const nearbySites = options.nearbySites ?? [];
  const ellipseRadiusKm = options.ellipseRadiusKm ?? 0;
  const onSelect = options.onSelect;

  // ── Map shell (ported DOM structure) ──
  const root = document.createElement("div");
  root.className = "lunar-map";

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
  const locator = createMoonLocator(globeHost);
  const locatorCaption = document.createElement("div");
  locatorCaption.className = "locator-caption";
  const locatorCaptionDot = document.createElement("i");
  locatorCaption.appendChild(locatorCaptionDot);
  locatorCaption.appendChild(document.createTextNode("Current view"));
  const locatorSmall = document.createElement("small");
  locatorSmall.textContent = "";
  locatorRoot.appendChild(locatorTitle);
  locatorRoot.appendChild(globeHost);
  locatorRoot.appendChild(locatorCaption);
  locatorRoot.appendChild(locatorSmall);
  root.appendChild(locatorRoot);

  const controls = document.createElement("div");
  controls.className = "map-controls";
  const makeControl = (label: string, onClick: () => void): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    controls.appendChild(button);
    return button;
  };
  makeControl("+ Zoom in", () => zoom(0.5));
  makeControl("− Zoom out", () => zoom(2));
  makeControl("←", () => zoom(1, -0.25));
  makeControl("→", () => zoom(1, 0.25));
  makeControl("↑", () => zoom(1, 0, 0.25));
  makeControl("↓", () => zoom(1, 0, -0.25));
  const resetControl = makeControl("Reset view", () => reset());
  resetControl.setAttribute("aria-label", "Reset lunar map view");
  root.appendChild(controls);

  const legend = document.createElement("p");
  legend.className = "map-legend";
  legend.innerHTML = "NASA / LRO LOLA DEM · 85°S–90°S<br /><span>Drag to pan · Scroll to zoom</span>";
  root.appendChild(legend);

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
  let animationId: number | null = null;

  const setViewport = (next: ViewportBox | null): void => {
    const box = next ? fitPolarViewport(next, aspect) : null;
    currentBox = box ?? initialPolarViewport(aspect);
    render();
  };

  const cancelAnimation = (): void => {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  };

  const moveCamera = (target: ViewportBox, animate = false): void => {
    const fitted = fitPolarViewport(target, aspect);
    cancelAnimation();
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setViewport(fitted);
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
      setViewport(next);
      if (progress < 1) animationId = requestAnimationFrame(step);
    };
    animationId = requestAnimationFrame(step);
  };

  // ── Camera actions ──
  function zoom(factor: number, dx = 0, dy = 0): void {
    const box = currentBox;
    const width = Math.max(1000, Math.min(2 * polarRadius, (box.xmax - box.xmin) * factor));
    const height = (width * (box.ymax - box.ymin)) / (box.xmax - box.xmin);
    const x = (box.xmin + box.xmax) / 2;
    const y = (box.ymin + box.ymax) / 2;
    moveCamera(
      {
        xmin: x - width / 2 + dx * width,
        xmax: x + width / 2 + dx * width,
        ymin: y - height / 2 + dy * height,
        ymax: y + height / 2 + dy * height,
      },
      true,
    );
  }

  function reset(): void {
    moveCamera(initialPolarViewport(aspect), true);
  }

  function fitToSite(site: LunarSite): void {
    const point = projectSite(site.latDeg, site.eastLonDeg);
    const width = Math.max(4000, (polarExtent.xmax - polarExtent.xmin) / 6);
    const height = width / aspect;
    moveCamera({ xmin: point.x - width / 2, xmax: point.x + width / 2, ymin: point.y - height / 2, ymax: point.y + height / 2 }, true);
  }

  // ── Interaction: wheel zoom, drag pan ──
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    cancelAnimation();
    const box = currentBox;
    const rect = surface.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    const width = Math.max(1000, Math.min(2 * polarRadius, (box.xmax - box.xmin) * Math.exp(event.deltaY * 0.0015)));
    const height = (width * (box.ymax - box.ymin)) / (box.xmax - box.xmin);
    const x = box.xmin + fx * (box.xmax - box.xmin);
    const y = box.ymax - fy * (box.ymax - box.ymin);
    setViewport({ xmin: x - fx * width, xmax: x + (1 - fx) * width, ymin: y - (1 - fy) * height, ymax: y + fy * height });
  };
  surface.addEventListener("wheel", onWheel, { passive: false });

  let dragState: { x: number; y: number; bbox: ViewportBox } | null = null;
  const onPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Element && event.target.closest("button")) return;
    if (event.button !== 0) return;
    cancelAnimation();
    dragState = { x: event.clientX, y: event.clientY, bbox: currentBox };
    surface.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragState) return;
    const rect = surface.getBoundingClientRect();
    const dx = ((event.clientX - dragState.x) / rect.width) * (dragState.bbox.xmax - dragState.bbox.xmin);
    const dy = ((event.clientY - dragState.y) / rect.height) * (dragState.bbox.ymax - dragState.bbox.ymin);
    setViewport({ xmin: dragState.bbox.xmin - dx, xmax: dragState.bbox.xmax - dx, ymin: dragState.bbox.ymin + dy, ymax: dragState.bbox.ymax + dy });
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
    const box = currentBox;
    renderMoonBasemap(coverage, box, surface.clientWidth || 800);

    while (annotationsEl.firstChild) {
      annotationsEl.removeChild(annotationsEl.firstChild);
    }
    const markers: readonly LunarSite[] = [selected, ...nearbySites.filter((n) => n.id !== selected.id)];
    for (const marker of markers) {
      const point = projectSite(marker.latDeg, marker.eastLonDeg);
      if (Math.hypot(point.x, point.y) > polarRadius) continue;
      const x = ((point.x - box.xmin) / (box.xmax - box.xmin)) * 100;
      const y = ((box.ymax - point.y) / (box.ymax - box.ymin)) * 100;
      if (x < 0 || x > 100 || y < 0 || y > 100) continue;

      const annotation = document.createElement("div");
      annotation.className = `map-annotation${marker.id === selected.id ? " is-selected" : ""}`;
      annotation.style.left = `${x}%`;
      annotation.style.top = `${y}%`;

      const callout = document.createElement("button");
      callout.type = "button";
      callout.className = "spot-callout";
      callout.setAttribute("aria-label", `View ${marker.id}`);
      callout.innerHTML = `<strong>${marker.id}</strong><span class="spot-summary"><span>${marker.id === selected.id ? "Landing site" : "Candidate"}</span><b>${marker.id === selected.id ? "—" : ""}</b></span>`;
      callout.addEventListener("click", () => onSelect?.(marker));
      annotation.appendChild(callout);

      const markerBtn = document.createElement("button");
      markerBtn.type = "button";
      markerBtn.className = "spot-marker";
      markerBtn.setAttribute("aria-label", `Select ${marker.id}`);
      markerBtn.addEventListener("click", () => onSelect?.(marker));
      annotation.appendChild(markerBtn);
      annotationsEl.appendChild(annotation);
    }

    // Landing ellipse overlay in viewport pixel coordinates.
    const rect = surface.getBoundingClientRect();
    const pixelWidth = Math.max(1, rect.width);
    const pixelHeight = Math.max(1, rect.height);
    const widthM = box.xmax - box.xmin;
    const heightM = box.ymax - box.ymin;
    const center = projectSite(selected.latDeg, selected.eastLonDeg);
    ellipse.setAttribute("cx", String(((center.x - box.xmin) / widthM) * pixelWidth));
    ellipse.setAttribute("cy", String(((box.ymax - center.y) / heightM) * pixelHeight));
    ellipse.setAttribute("rx", String(((ellipseRadiusKm * 1000) / widthM) * pixelWidth));
    ellipse.setAttribute("ry", String(((ellipseRadiusKm * 1000) / heightM) * pixelHeight));

    locator?.update(box);
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
