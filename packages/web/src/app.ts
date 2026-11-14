/**
 * Main application — Lunar Landing Site Navigator dashboard.
 *
 * Layout (no-scroll, full viewport):
 *   - Top bar: app name + data status
 *   - Left sidebar: controls (site, date, constraints) + map panel
 *   - Center: 3D lunar scene (primary visual)
 *   - Right panel: sky metrics + horizon chart + constraints
 *   - Bottom bar: slip window timeline + share link
 *
 * Uses plain DOM manipulation (no React/Vue) to keep the bundle small.
 * Accessibility: keyboard nav, ARIA labels, colorblind-safe palette.
 */

import "./index.css";
import { appName } from "./main";
import {
  type ScenarioState,
  defaultScenario,
  readScenarioFromUrl,
  scenarioToUrl,
  scenarioToQuery,
  PRESET_SITES,
  siteLabel,
} from "./scenario";
import type { Constraint, Verdict } from "core";
import { LunarScene } from "./scene";
import { loadMoonMapImage, drawMaps, bindMapClicks, type MapPanelHandles } from "./mapPanel";
import { renderHorizonChart } from "./horizonChart";
import {
  skyAtForDate,
  horizonMaskForSite,
  evaluateUiConstraints,
  type ScienceStatus,
  horizonsVerifyUrl,
} from "./science";

/* ── DOM helpers ── */

function el(tag: string, attrs: Record<string, string> = {}, ...children: (string | Node)[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, value);
  }
  for (const child of children) {
    if (typeof child === "string") {
      element.appendChild(document.createTextNode(child));
    } else {
      element.appendChild(child);
    }
  }
  return element;
}

function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/* ── State ── */

let state: ScenarioState = defaultScenario();
let scene: LunarScene | null = null;
let sceneContainerEl: HTMLElement | null = null;
let viewMode: "overview" | "site-level" = "overview";
let mapHandles: MapPanelHandles | null = null;

/* ── Science status ── */

function getScienceStatus(): ScienceStatus {
  return (
    (window as unknown as { __scienceConfigured?: ScienceStatus }).__scienceConfigured ?? {
      ephemeris: false,
      masks: false,
    }
  );
}

/* ── Render ── */

async function render() {
  const root = document.getElementById("app");
  if (!root) return;

  const isFirstRender = !root.querySelector("header");

  if (isFirstRender) {
    clear(root);
    buildDashboard(root);
    await initSceneAndData();
  } else {
    // Update existing dashboard
    updateDashboard();
    const sky = await skyAtForDate(state.site, state.dateUtc, 12);
    if (scene) {
      scene.update(state.site, sky);
    }
    await updateRightPanel();
    updateMap();
  }
}

function buildDashboard(root: HTMLElement) {
  // Skip link
  root.appendChild(el("a", { href: "#main-content", class: "skip-link" }, "Skip to main content"));

  // Top bar
  root.appendChild(renderTopBar());

  // Main dashboard area
  const dashboard = el("div", {
    id: "main-content",
    class: "flex flex-1 min-h-0",
    role: "main",
    "aria-label": "Landing site navigation dashboard",
  });

  // Left sidebar
  dashboard.appendChild(buildLeftSidebar());

  // Center: 3D scene
  const centerArea = el("div", {
    id: "center-area",
    class: "flex-1 relative min-w-0",
  });
  sceneContainerEl = el("div", {
    id: "scene-container",
    class: "absolute inset-0 bg-black",
  });
  centerArea.appendChild(sceneContainerEl);

  // View mode toggle overlay
  const toggleContainer = el("div", {
    class: "absolute top-3 right-3 flex gap-1.5 z-10",
  });
  toggleContainer.appendChild(buildViewBtn("overview", "Overview"));
  toggleContainer.appendChild(buildViewBtn("site-level", "Site level"));
  centerArea.appendChild(toggleContainer);

  // Not to scale label
  const scaleLabel = el("div", {
    id: "scale-label",
    class: "absolute bottom-3 left-3 text-[10px] text-[var(--color-text-muted)] bg-[var(--color-bg-surface)] bg-opacity-80 px-2 py-0.5 rounded",
  }, "Not to scale");
  centerArea.appendChild(scaleLabel);

  dashboard.appendChild(centerArea);

  // Right panel
  dashboard.appendChild(buildRightPanel());

  root.appendChild(dashboard);

  // Bottom bar
  root.appendChild(buildBottomBar());
}

function buildViewBtn(mode: "overview" | "site-level", label: string): HTMLElement {
  const btn = el("button", {
    class: `rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${
      viewMode === mode
        ? "bg-[var(--color-accent)] text-white"
        : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
    }`,
    "aria-label": `Switch to ${mode} mode`,
    "aria-pressed": viewMode === mode ? "true" : "false",
  }, label);
  btn.addEventListener("click", () => {
    viewMode = mode;
    scene?.setViewMode(mode);
    const scaleLabel = document.getElementById("scale-label");
    if (scaleLabel) scaleLabel.style.display = mode === "overview" ? "" : "none";
    render();
  });
  return btn;
}

function buildLeftSidebar(): HTMLElement {
  const sidebar = el("aside", {
    id: "left-sidebar",
    class: "w-[280px] flex-shrink-0 flex flex-col bg-[var(--color-bg-surface)] border-r border-[var(--color-border)] overflow-y-auto",
  });

  // Controls section
  const controls = el("div", {
    class: "p-3 space-y-3 border-b border-[var(--color-border)]",
  });

  // Site selector
  const siteSelect = el("select", {
    id: "site-select",
    class: "w-full rounded-md bg-[var(--color-bg-input)] border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)]",
    "aria-label": "Select landing site",
  });
  for (const site of PRESET_SITES) {
    const opt = el("option", { value: site.id }, `${siteLabel(site.id)} (${site.latDeg}°, ${site.eastLonDeg}°)`);
    if (site.id === state.site.id) opt.setAttribute("selected", "");
    siteSelect.appendChild(opt);
  }
  (siteSelect as HTMLSelectElement).addEventListener("change", (e) => {
    const selected = PRESET_SITES.find((s) => s.id === (e.target as HTMLSelectElement).value);
    if (selected) {
      state = { ...state, site: selected };
      syncUrl();
      void render();
    }
  });
  controls.appendChild(siteSelect);

  // Custom coordinates
  const coordRow = el("div", { class: "grid grid-cols-2 gap-2" });
  const lonInput = el("input", {
    type: "number",
    step: "0.01",
    value: state.site.eastLonDeg.toString(),
    placeholder: "Lon °E",
    class: "rounded-md bg-[var(--color-bg-input)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)]",
    "aria-label": "Site east longitude",
  }) as HTMLInputElement;
  const latInput = el("input", {
    type: "number",
    step: "0.01",
    value: state.site.latDeg.toString(),
    placeholder: "Lat °N",
    class: "rounded-md bg-[var(--color-bg-input)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)]",
    "aria-label": "Site latitude",
  }) as HTMLInputElement;
  coordRow.appendChild(lonInput);
  coordRow.appendChild(latInput);

  const applyBtn = el("button", {
    class: "col-span-2 rounded-md bg-[var(--color-accent)] px-2 py-1 text-xs font-medium text-white hover:bg-blue-600 transition-colors",
    "aria-label": "Apply custom coordinates",
  }, "Apply");
  const applyCustom = () => {
    const lon = parseFloat(lonInput.value);
    const lat = parseFloat(latInput.value);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      state = { ...state, site: { id: "custom", eastLonDeg: lon, latDeg: lat } };
      syncUrl();
      void render();
    }
  };
  applyBtn.addEventListener("click", applyCustom);
  lonInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyCustom(); } });
  latInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyCustom(); } });
  coordRow.appendChild(applyBtn);
  controls.appendChild(coordRow);

  // Date picker
  const dateInput = el("input", {
    type: "date",
    value: state.dateUtc,
    class: "w-full rounded-md bg-[var(--color-bg-input)] border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)]",
    "aria-label": "Select landing date",
  }) as HTMLInputElement;
  dateInput.addEventListener("change", () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) {
      state = { ...state, dateUtc: dateInput.value };
      syncUrl();
      void render();
    }
  });
  controls.appendChild(dateInput);

  // Constraints
  const constraintKinds = [
    { id: "sunAboveHorizon", label: "Sun above horizon" },
    { id: "earthAboveHorizon", label: "Earth above horizon" },
    { id: "sunAboveMask", label: "Sun above terrain" },
    { id: "earthAboveMask", label: "Earth above terrain" },
  ];
  const constraintList = el("div", { class: "space-y-1" });
  for (const ck of constraintKinds) {
    const checked = state.constraints.some((c) => c.kind === ck.id);
    const label = el("label", {
      class: "flex items-center gap-2 text-xs cursor-pointer",
      "aria-label": ck.label,
    });
    const checkbox = el("input", {
      type: "checkbox",
      class: "rounded border-[var(--color-border)] bg-[var(--color-bg-input)] accent-[var(--color-accent)]",
    }) as HTMLInputElement;
    checkbox.checked = checked;
    checkbox.addEventListener("change", () => {
      const updated: Constraint[] = checkbox.checked
        ? [...state.constraints, { id: ck.id, kind: ck.id }]
        : state.constraints.filter((c) => c.kind !== ck.id);
      state = { ...state, constraints: updated };
      syncUrl();
      void render();
    });
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(ck.label));
    constraintList.appendChild(label);
  }
  controls.appendChild(constraintList);
  sidebar.appendChild(controls);

  // Map panel
  const mapSection = el("div", {
    id: "map-section",
    class: "flex-1 flex flex-col min-h-0 p-3",
  });
  mapSection.appendChild(el("h2", { class: "text-[10px] font-medium mb-2 text-[var(--color-text-muted)] uppercase tracking-wider" }, "Map"));

  const globalCanvas = el("canvas", {
    id: "map-global",
    class: "w-full h-[100px] rounded-md border border-[var(--color-border)] cursor-crosshair mb-2",
    "aria-label": "Global lunar map. Click to select a site.",
  }) as HTMLCanvasElement;

  const polarCanvas = el("canvas", {
    id: "map-polar",
    class: "w-full h-[120px] rounded-md border border-[var(--color-border)] cursor-crosshair",
    "aria-label": "South polar inset map. Click to select a site.",
  }) as HTMLCanvasElement;

  mapSection.appendChild(globalCanvas);
  mapSection.appendChild(polarCanvas);
  sidebar.appendChild(mapSection);

  // Store handles for map drawing
  mapHandles = { global: globalCanvas, polar: polarCanvas };

  // Bind map clicks
  bindMapClicks(mapHandles, (lon, lat) => {
    state = { ...state, site: { id: "custom", eastLonDeg: lon, latDeg: lat } };
    syncUrl();
    void render();
  });

  return sidebar;
}

function buildRightPanel(): HTMLElement {
  const panel = el("aside", {
    id: "right-panel",
    class: "w-[320px] flex-shrink-0 flex flex-col bg-[var(--color-bg-surface)] border-l border-[var(--color-border)] overflow-y-auto",
  });

  // Sky metrics section
  const skySection = el("div", {
    id: "sky-section",
    class: "p-3 border-b border-[var(--color-border)]",
  });
  skySection.appendChild(el("h2", { class: "text-[10px] font-medium mb-2 text-[var(--color-text-muted)] uppercase tracking-wider" }, "Sky State"));
  const skyMetrics = el("div", { id: "sky-metrics", class: "grid grid-cols-2 gap-2" });
  skySection.appendChild(skyMetrics);
  panel.appendChild(skySection);

  // Horizon chart section
  const chartSection = el("div", {
    id: "chart-section",
    class: "p-3 border-b border-[var(--color-border)]",
  });
  chartSection.appendChild(el("h2", { class: "text-[10px] font-medium mb-2 text-[var(--color-text-muted)] uppercase tracking-wider" }, "Horizon"));
  const chartSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chartSvg.setAttribute("id", "horizon-svg");
  chartSvg.setAttribute("width", "100%");
  chartSvg.setAttribute("height", "100%");
  chartSvg.style.width = "100%";
  chartSvg.style.height = "160px";
  chartSection.appendChild(chartSvg);
  panel.appendChild(chartSection);

  // Constraints section
  const constraintsSection = el("div", {
    id: "constraints-section",
    class: "p-3",
  });
  constraintsSection.appendChild(el("h2", { class: "text-[10px] font-medium mb-2 text-[var(--color-text-muted)] uppercase tracking-wider" }, "Constraints"));
  const constraintsList = el("div", { id: "constraints-list", class: "space-y-2" });
  constraintsSection.appendChild(constraintsList);
  panel.appendChild(constraintsSection);

  return panel;
}

function buildBottomBar(): HTMLElement {
  const bar = el("div", {
    id: "bottom-bar",
    class: "h-[140px] flex-shrink-0 bg-[var(--color-bg-surface)] border-t border-[var(--color-border)] flex",
  });

  // Slip window section
  const slipSection = el("div", {
    id: "slip-section",
    class: "flex-1 flex flex-col min-w-0 p-3 border-r border-[var(--color-border)]",
  });
  slipSection.appendChild(el("h2", { class: "text-[10px] font-medium mb-1 text-[var(--color-text-muted)] uppercase tracking-wider" }, "Slip Window"));

  const slipControls = el("div", { class: "flex items-center gap-2 mb-2" });
  const rangeInput = el("input", {
    type: "number",
    id: "range-days",
    min: "1",
    max: "90",
    value: "14",
    class: "w-16 rounded-md bg-[var(--color-bg-input)] border border-[var(--color-border)] px-1.5 py-0.5 text-xs text-[var(--color-text-primary)]",
    "aria-label": "Days to scan",
  }) as HTMLInputElement;
  slipControls.appendChild(el("label", { class: "text-[10px] text-[var(--color-text-muted)]" }, "Days:"));
  slipControls.appendChild(rangeInput);

  const runBtn = el("button", {
    class: "rounded-md bg-[var(--color-accent)] px-3 py-0.5 text-[10px] font-medium text-white hover:bg-blue-600 transition-colors",
    "aria-label": "Run slip window search",
  }, "Search");
  slipControls.appendChild(runBtn);
  slipSection.appendChild(slipControls);

  const slipResults = el("div", {
    id: "slip-results",
    class: "flex-1 overflow-y-auto rounded-md border border-[var(--color-border)]",
    role: "region",
    "aria-label": "Slip window results",
    "aria-live": "polite",
  });
  slipSection.appendChild(slipResults);
  bar.appendChild(slipSection);

  // Share section
  const shareSection = el("div", {
    id: "share-section",
    class: "w-[280px] flex-shrink-0 flex flex-col p-3",
  });
  shareSection.appendChild(el("h2", { class: "text-[10px] font-medium mb-1 text-[var(--color-text-muted)] uppercase tracking-wider" }, "Share"));

  const urlInput = el("input", {
    type: "text",
    readonly: "",
    value: scenarioToUrl(state),
    class: "w-full rounded-md bg-[var(--color-bg-input)] border border-[var(--color-border)] px-2 py-1 text-[10px] font-mono text-[var(--color-text-secondary)]",
    "aria-label": "Shareable scenario URL",
  }) as HTMLInputElement;
  shareSection.appendChild(urlInput);

  const copyBtn = el("button", {
    class: "mt-1.5 rounded-md border border-[var(--color-border)] px-3 py-0.5 text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] transition-colors",
    "aria-label": "Copy URL",
  }, "Copy URL");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(scenarioToUrl(state));
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy URL"; }, 2000);
    } catch {
      urlInput.select();
      document.execCommand("copy");
    }
  });
  shareSection.appendChild(copyBtn);

  // Verification links
  const verifyLinks = el("div", { class: "mt-2 flex gap-2" });
  const sunLink = el("a", {
    href: "",
    target: "_blank",
    rel: "noopener",
    class: "text-[9px] text-[var(--color-sun)] hover:underline",
  }, "Verify Sun ↗");
  const earthLink = el("a", {
    href: "",
    target: "_blank",
    rel: "noopener",
    class: "text-[9px] text-[var(--color-earth)] hover:underline",
  }, "Verify Earth ↗");
  verifyLinks.appendChild(sunLink);
  verifyLinks.appendChild(earthLink);
  shareSection.appendChild(verifyLinks);

  bar.appendChild(shareSection);

  // Run slip search
  const runSearch = async () => {
    clear(slipResults);
    const days = parseInt(rangeInput.value, 10) || 14;
    slipResults.appendChild(el("p", { class: "p-2 text-[10px] text-[var(--color-text-muted)]" }, "Searching..."));

    try {
      const { sampleDailyWindows } = await import("./science");
      const samples = await sampleDailyWindows(state.site, state.dateUtc, 12, days, state.constraints);

      clear(slipResults);
      if (samples.length === 0) {
        slipResults.appendChild(el("p", { class: "p-2 text-[10px] text-[var(--color-text-muted)]" }, "No results."));
        return;
      }

      // Summary
      const meets = samples.filter((s) => s.verdict === "meets").length;
      const misses = samples.filter((s) => s.verdict === "misses").length;
      const unknown = samples.filter((s) => s.verdict === "unknown").length;
      const summary = el("div", { class: "flex gap-3 px-2 py-1 text-[10px] border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]" });
      summary.appendChild(el("span", { class: "text-[var(--color-meets)] font-medium" }, `${meets} meets`));
      summary.appendChild(el("span", { class: "text-[var(--color-misses)] font-medium" }, `${misses} misses`));
      if (unknown > 0) summary.appendChild(el("span", { class: "text-[var(--color-unknown)] font-medium" }, `${unknown} ?`));
      slipResults.appendChild(summary);

      // Table
      const table = el("table", { class: "w-full text-[10px]", "aria-label": "Slip window results" });
      const thead = el("thead", {});
      const headerRow = el("tr", { class: "border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]" });
      for (const th of ["Date", "Verdict", "Sun °", "Earth °"]) {
        const cell = el("th", { class: "px-2 py-1 text-left text-[9px] font-medium text-[var(--color-text-muted)]", scope: "col" }, th);
        headerRow.appendChild(cell);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = el("tbody", {});
      const colorMap: Record<Verdict, string> = {
        meets: "var(--color-meets)",
        misses: "var(--color-misses)",
        unknown: "var(--color-unknown)",
      };
      for (const sample of samples) {
        const tr = el("tr", { class: "border-b border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)]" });
        tr.appendChild(el("td", { class: "px-2 py-0.5 font-mono text-[9px]" }, sample.dateUtc));
        const verdictCell = el("td", { class: "px-2 py-0.5" });
        const badge = el("span", {
          class: "inline-block px-1.5 py-0.5 rounded text-[9px] font-medium",
          style: `color: ${colorMap[sample.verdict]}; background-color: ${colorMap[sample.verdict]}22;`,
        }, sample.verdict.toUpperCase());
        verdictCell.appendChild(badge);
        tr.appendChild(verdictCell);
        tr.appendChild(el("td", { class: "px-2 py-0.5 text-[9px]" }, sample.sunElevationDeg.toFixed(1)));
        tr.appendChild(el("td", { class: "px-2 py-0.5 text-[9px]" }, sample.earthElevationDeg.toFixed(1)));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      slipResults.appendChild(table);
    } catch (err) {
      clear(slipResults);
      slipResults.appendChild(el("p", { class: "p-2 text-[10px] text-[var(--color-misses)]" }, `Error: ${err}`));
    }
  };

  runBtn.addEventListener("click", runSearch);
  rangeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } });

  // Run initial search
  runSearch();

  return bar;
}

function renderTopBar(): HTMLElement {
  const config = getScienceStatus();
  const dataLabel = config.ephemeris && config.masks
    ? "Pipeline data"
    : config.ephemeris || config.masks
      ? "Partial data"
      : "Mock data";
  const dataColor = config.ephemeris && config.masks
    ? "text-[var(--color-meets)]"
    : config.ephemeris || config.masks
      ? "text-[var(--color-unknown)]"
      : "text-[var(--color-text-muted)]";

  return el(
    "header",
    { class: "h-[36px] flex-shrink-0 flex items-center justify-between px-4 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]" },
    el("div", { class: "flex items-center gap-3" },
      el("h1", { class: "text-sm font-semibold tracking-tight" }, appName),
    ),
    el("span", {
      class: `text-[10px] font-medium ${dataColor}`,
    }, dataLabel),
  );
}

/* ── Update functions for re-renders ── */

function updateDashboard() {
  // Update site selector
  const siteSelect = document.getElementById("site-select") as HTMLSelectElement | null;
  if (siteSelect) siteSelect.value = state.site.id;

  // Update coordinate inputs
  const lonInput = document.querySelector("#left-sidebar input[placeholder='Lon °E']") as HTMLInputElement | null;
  const latInput = document.querySelector("#left-sidebar input[placeholder='Lat °N']") as HTMLInputElement | null;
  if (lonInput) lonInput.value = state.site.eastLonDeg.toString();
  if (latInput) latInput.value = state.site.latDeg.toString();

  // Update date input
  const dateInput = document.querySelector("#left-sidebar input[type='date']") as HTMLInputElement | null;
  if (dateInput) dateInput.value = state.dateUtc;

  // Update share URL
  const urlInput = document.querySelector("#share-section input[readonly]") as HTMLInputElement | null;
  if (urlInput) urlInput.value = scenarioToUrl(state);

  // Update verification links
  const sunLink = document.querySelector("#share-section a[href]") as HTMLAnchorElement | null;
  const earthLink = document.querySelectorAll("#share-section a[href]")[1] as HTMLAnchorElement | null;
  if (sunLink) sunLink.href = horizonsVerifyUrl(state.site, state.dateUtc, "sun");
  if (earthLink) earthLink.href = horizonsVerifyUrl(state.site, state.dateUtc, "earth");
}

function updateMap() {
  if (mapHandles) {
    drawMaps(mapHandles, state.site);
  }
}

async function updateRightPanel() {
  const sky = await skyAtForDate(state.site, state.dateUtc, 12);
  const { mask } = await horizonMaskForSite(state.site);

  // Sky metrics
  const skyMetrics = document.getElementById("sky-metrics");
  if (skyMetrics) {
    clear(skyMetrics);
    const metrics = [
      { label: "Sun elevation", value: `${sky.sunElevationDeg.toFixed(1)}°`, color: "text-[var(--color-sun)]" },
      { label: "Sun azimuth", value: `${sky.sunAzimuthDeg.toFixed(0)}°`, color: "text-[var(--color-sun)]" },
      { label: "Earth elevation", value: `${sky.earthElevationDeg.toFixed(1)}°`, color: "text-[var(--color-earth)]" },
      { label: "Earth azimuth", value: `${sky.earthAzimuthDeg.toFixed(0)}°`, color: "text-[var(--color-earth)]" },
    ];
    for (const m of metrics) {
      const item = el("div", { class: "bg-[var(--color-bg-elevated)] rounded-md px-2 py-1.5" });
      item.appendChild(el("div", { class: "text-[9px] text-[var(--color-text-muted)]" }, m.label));
      item.appendChild(el("div", { class: `text-sm font-mono font-semibold ${m.color}` }, m.value));
      skyMetrics.appendChild(item);
    }
  }

  // Horizon chart
  const chartSvg = document.getElementById("horizon-svg") as SVGSVGElement | null;
  if (chartSvg) {
    renderHorizonChart(chartSvg, mask, sky);
  }

  // Constraints
  const constraintsList = document.getElementById("constraints-list");
  if (constraintsList) {
    clear(constraintsList);
    if (state.constraints.length === 0) {
      constraintsList.appendChild(el("p", { class: "text-[10px] text-[var(--color-text-muted)]" }, "No constraints selected."));
    } else {
      const rows = evaluateUiConstraints(state.constraints, sky, mask);
      for (const row of rows) {
        const colorMap: Record<Verdict, string> = {
          meets: "var(--color-meets)",
          misses: "var(--color-misses)",
          unknown: "var(--color-unknown)",
        };
        const labelMap: Record<Verdict, string> = {
          meets: "Meets",
          misses: "Misses",
          unknown: "Unknown",
        };
        const item = el("div", { class: "flex items-start gap-2" });
        const indicator = el("div", {
          class: "mt-0.5 w-2 h-2 rounded-full flex-shrink-0",
          style: `background-color: ${colorMap[row.verdict]}`,
          "aria-hidden": "true",
        });
        item.appendChild(indicator);
        const text = el("div", { class: "flex-1 min-w-0" });
        text.appendChild(el("div", { class: "text-[11px] font-medium truncate" }, `${row.label} — ${labelMap[row.verdict]}`));
        text.appendChild(el("div", { class: "text-[9px] text-[var(--color-text-muted)] truncate" }, row.reason));
        item.appendChild(text);
        constraintsList.appendChild(item);
      }
    }
  }
}

/* ── Initialize 3D scene and load data ── */

async function initSceneAndData() {
  // Load moon map image for the map panel
  try {
    await loadMoonMapImage();
    updateMap();
  } catch {
    console.warn("Could not load moon map texture");
  }

  // Initialize 3D scene
  if (sceneContainerEl) {
    const sky = await skyAtForDate(state.site, state.dateUtc, 12);
    scene = new LunarScene({
      container: sceneContainerEl,
      site: state.site,
      skyState: sky,
      viewMode,
    });
  }

  // Update right panel with data
  await updateRightPanel();
}

/* ── URL sync ── */

function syncUrl() {
  const params = new URLSearchParams(scenarioToQuery(state));
  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", newUrl);
}

/* ── Keyboard navigation ── */

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement | null;
    dateInput?.focus();
  }
});

/* ── Window resize ── */

window.addEventListener("resize", () => {
  scene?.resize();
  updateMap();
});

/* ── Init ── */

state = readScenarioFromUrl();
render().catch((e) => console.error("Render failed:", e));
