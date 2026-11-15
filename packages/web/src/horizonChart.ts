/**
 * Interactive LOLA Terrain Horizon Profile Chart (SVG).
 *
 * Renders:
 * - 0° to 360° Azimuth on X axis with Cardinal labels (N, E, S, W)
 * - Elevation on Y axis (-10° to +30°)
 * - Shaded DEM terrain silhouette polygon
 * - Spherical horizon line at 0° (or -0.0869° dip)
 * - Sun position marker with azimuth drop line and glow
 * - Earth position marker with comms ray and glow
 * - Interactive hover / scrub tooltip displaying exact azimuth, terrain elevation,
 *   and clearance margin.
 */

import type { HorizonMask, SkyState } from "core";

export function renderHorizonChart(
  svg: SVGSVGElement,
  mask: HorizonMask | null,
  sky: SkyState,
  onHover?: (azimuthDeg: number, elevDeg: number) => void,
): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const width = 640;
  const height = 200;
  const pad = { top: 22, right: 16, bottom: 28, left: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");

  const maskNote = mask
    ? `LOLA DEM terrain mask (${mask.elevationDeg.length} azimuth samples)`
    : "Spherical horizon model (airless Moon, R=1737.4 km, h=2m)";
  svg.setAttribute(
    "aria-label",
    `Terrain Horizon Profile. Sun at ${sky.sunElevationDeg.toFixed(1)}° elev, ${sky.sunAzimuthDeg.toFixed(0)}° az. Earth at ${sky.earthElevationDeg.toFixed(1)}° elev, ${sky.earthAzimuthDeg.toFixed(0)}° az. ${maskNote}.`,
  );

  const samples = mask?.elevationDeg ?? new Array(360).fill(-0.0869);
  const minElev = Math.min(-4, Math.floor(Math.min(...samples, sky.sunElevationDeg, sky.earthElevationDeg) - 2));
  const maxElev = Math.max(8, Math.ceil(Math.max(...samples, sky.sunElevationDeg, sky.earthElevationDeg) + 4));

  const xScale = (az: number) => pad.left + (az / 360) * plotW;
  const yScale = (elev: number) => pad.top + plotH - ((elev - minElev) / (maxElev - minElev)) * plotH;

  const ns = "http://www.w3.org/2000/svg";
  const node = (tag: string, attrs: Record<string, string>, text?: string) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    svg.appendChild(el);
    return el;
  };

  // Defs for gradients and glow filters
  const defs = document.createElementNS(ns, "defs");
  const terrainGrad = document.createElementNS(ns, "linearGradient");
  terrainGrad.setAttribute("id", "terrainGrad");
  terrainGrad.setAttribute("x1", "0");
  terrainGrad.setAttribute("y1", "0");
  terrainGrad.setAttribute("x2", "0");
  terrainGrad.setAttribute("y2", "1");
  const stop1 = document.createElementNS(ns, "stop");
  stop1.setAttribute("offset", "0%");
  stop1.setAttribute("stop-color", "rgba(161, 161, 170, 0.45)");
  const stop2 = document.createElementNS(ns, "stop");
  stop2.setAttribute("offset", "100%");
  stop2.setAttribute("stop-color", "rgba(39, 39, 42, 0.15)");
  terrainGrad.appendChild(stop1);
  terrainGrad.appendChild(stop2);
  defs.appendChild(terrainGrad);
  svg.appendChild(defs);

  // Background grid lines and azimuth ticks
  const azimuthTicks = [
    { az: 0, label: "N 0°" },
    { az: 45, label: "NE" },
    { az: 90, label: "E 90°" },
    { az: 135, label: "SE" },
    { az: 180, label: "S 180°" },
    { az: 225, label: "SW" },
    { az: 270, label: "W 270°" },
    { az: 315, label: "NW" },
    { az: 360, label: "N 360°" },
  ];

  for (const tick of azimuthTicks) {
    const isMajor = tick.az % 90 === 0;
    node("line", {
      x1: String(xScale(tick.az)),
      x2: String(xScale(tick.az)),
      y1: String(pad.top),
      y2: String(pad.top + plotH),
      stroke: isMajor ? "var(--color-border)" : "rgba(39,39,42,0.4)",
      "stroke-width": isMajor ? "1" : "0.5",
    });
    node(
      "text",
      {
        x: String(xScale(tick.az)),
        y: String(height - 8),
        fill: isMajor ? "var(--color-text-primary)" : "var(--color-text-muted)",
        "font-size": isMajor ? "10" : "9",
        "font-weight": isMajor ? "600" : "400",
        "text-anchor": "middle",
      },
      tick.label,
    );
  }

  // 0° Horizontal Reference Line (Dashed)
  node("line", {
    x1: String(pad.left),
    x2: String(pad.left + plotW),
    y1: String(yScale(0)),
    y2: String(yScale(0)),
    stroke: "var(--color-text-muted)",
    "stroke-dasharray": "4 4",
    "stroke-width": "1",
    opacity: "0.6",
  });
  node(
    "text",
    {
      x: String(pad.left - 6),
      y: String(yScale(0) + 3),
      fill: "var(--color-text-muted)",
      "font-size": "9",
      "text-anchor": "end",
    },
    "0°",
  );

  // Elevation Y-axis markers
  const elevSteps = [-5, 5, 10, 15, 20].filter((e) => e > minElev + 1 && e < maxElev - 1);
  for (const e of elevSteps) {
    node("line", {
      x1: String(pad.left),
      x2: String(pad.left + plotW),
      y1: String(yScale(e)),
      y2: String(yScale(e)),
      stroke: "rgba(39,39,42,0.3)",
      "stroke-width": "0.5",
    });
    node(
      "text",
      {
        x: String(pad.left - 6),
        y: String(yScale(e) + 3),
        fill: "var(--color-text-muted)",
        "font-size": "9",
        "text-anchor": "end",
      },
      `${e > 0 ? "+" : ""}${e}°`,
    );
  }

  // Terrain Silhouette Polygon
  const pts: string[] = [`${xScale(0)},${yScale(minElev)}`];
  const step = Math.max(1, Math.floor(samples.length / 180));
  for (let i = 0; i < samples.length; i += step) {
    const az = (i / samples.length) * 360;
    pts.push(`${xScale(az)},${yScale(samples[i])}`);
  }
  pts.push(`${xScale(360)},${yScale(samples[0])}`);
  pts.push(`${xScale(360)},${yScale(minElev)}`);

  node("polygon", {
    points: pts.join(" "),
    fill: "url(#terrainGrad)",
    stroke: "var(--color-terrain)",
    "stroke-width": "1.5",
  });

  // Draw Sun & Earth
  drawBody(node, xScale, yScale, sky.sunAzimuthDeg, sky.sunElevationDeg, "var(--color-sun)", "Sun", "#f59e0b");
  drawBody(node, xScale, yScale, sky.earthAzimuthDeg, sky.earthElevationDeg, "var(--color-earth)", "Earth", "#3b82f6");

  // Y-axis Title
  node(
    "text",
    {
      x: "12",
      y: String(pad.top + plotH / 2),
      fill: "var(--color-text-muted)",
      "font-size": "9",
      "letter-spacing": "0.05em",
      "text-anchor": "middle",
      transform: `rotate(-90, 12, ${pad.top + plotH / 2})`,
    },
    "ELEVATION (°)",
  );

  // Interactive Hover Reticle & Tooltip
  const hoverGroup = document.createElementNS(ns, "g");
  hoverGroup.style.display = "none";

  const hoverLine = document.createElementNS(ns, "line");
  hoverLine.setAttribute("y1", String(pad.top));
  hoverLine.setAttribute("y2", String(pad.top + plotH));
  hoverLine.setAttribute("stroke", "var(--color-accent)");
  hoverLine.setAttribute("stroke-dasharray", "2 2");
  hoverLine.setAttribute("stroke-width", "1");
  hoverGroup.appendChild(hoverLine);

  const hoverCircle = document.createElementNS(ns, "circle");
  hoverCircle.setAttribute("r", "4");
  hoverCircle.setAttribute("fill", "var(--color-accent)");
  hoverGroup.appendChild(hoverCircle);

  const tooltipBg = document.createElementNS(ns, "rect");
  tooltipBg.setAttribute("height", "20");
  tooltipBg.setAttribute("rx", "4");
  tooltipBg.setAttribute("fill", "var(--color-bg-surface)");
  tooltipBg.setAttribute("stroke", "var(--color-border)");
  hoverGroup.appendChild(tooltipBg);

  const tooltipText = document.createElementNS(ns, "text");
  tooltipText.setAttribute("fill", "var(--color-text-primary)");
  tooltipText.setAttribute("font-size", "9");
  tooltipText.setAttribute("font-family", "monospace");
  hoverGroup.appendChild(tooltipText);

  svg.appendChild(hoverGroup);

  // Mousemove listener for interactive readout
  svg.addEventListener("mousemove", (e: MouseEvent) => {
    const rect = svg.getBoundingClientRect();
    const xSvg = ((e.clientX - rect.left) / rect.width) * width;
    if (xSvg < pad.left || xSvg > pad.left + plotW) {
      hoverGroup.style.display = "none";
      return;
    }
    const az = ((xSvg - pad.left) / plotW) * 360;
    const sampleIdx = Math.min(samples.length - 1, Math.floor((az / 360) * samples.length));
    const terrainEl = samples[sampleIdx] ?? 0;
    const ySvg = yScale(terrainEl);

    hoverLine.setAttribute("x1", String(xSvg));
    hoverLine.setAttribute("x2", String(xSvg));
    hoverCircle.setAttribute("cx", String(xSvg));
    hoverCircle.setAttribute("cy", String(ySvg));

    const textContent = `Az: ${az.toFixed(1)}° | Elev: ${terrainEl.toFixed(1)}°`;
    tooltipText.textContent = textContent;

    const tipW = 120;
    const tipX = Math.max(pad.left, Math.min(width - pad.right - tipW, xSvg - tipW / 2));
    const tipY = Math.max(pad.top + 2, ySvg - 26);

    tooltipBg.setAttribute("x", String(tipX));
    tooltipBg.setAttribute("y", String(tipY));
    tooltipBg.setAttribute("width", String(tipW));

    tooltipText.setAttribute("x", String(tipX + 6));
    tooltipText.setAttribute("y", String(tipY + 14));

    hoverGroup.style.display = "";
    if (onHover) onHover(az, terrainEl);
  });

  svg.addEventListener("mouseleave", () => {
    hoverGroup.style.display = "none";
  });
}

function drawBody(
  node: (tag: string, attrs: Record<string, string>, text?: string) => SVGElement,
  xScale: (az: number) => number,
  yScale: (el: number) => number,
  az: number,
  el: number,
  color: string,
  label: string,
  glowColor: string,
) {
  const azimuth = ((az % 360) + 360) % 360;
  const cx = xScale(azimuth);
  const cy = yScale(el);

  // Drop line to bottom of plot
  node("line", {
    x1: String(cx),
    x2: String(cx),
    y1: String(cy),
    y2: String(yScale(-10)),
    stroke: color,
    "stroke-dasharray": "3 3",
    "stroke-width": "1",
    opacity: "0.7",
  });

  // Glowing corona ring
  node("circle", {
    cx: String(cx),
    cy: String(cy),
    r: "9",
    fill: glowColor,
    opacity: "0.25",
  });

  // Solid body circle
  node("circle", {
    cx: String(cx),
    cy: String(cy),
    r: "5",
    fill: color,
    stroke: "#ffffff",
    "stroke-width": "1",
  });

  // Label tag with elevation
  const labelX = cx + (azimuth > 300 ? -70 : 8);
  const labelY = Math.max(16, cy - 8);

  node(
    "text",
    {
      x: String(labelX),
      y: String(labelY),
      fill: color,
      "font-size": "10",
      "font-weight": "600",
    },
    `${label} ${el.toFixed(1)}°`,
  );
}
