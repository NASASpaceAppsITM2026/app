import type { HorizonMask, SkyState } from "core";

export function renderHorizonChart(
  svg: SVGSVGElement,
  mask: HorizonMask | null,
  sky: SkyState,
): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const width = 640;
  const height = 220;
  const pad = { top: 18, right: 12, bottom: 24, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  const maskNote = mask
    ? `terrain mask ${mask.status}`
    : "sphere-horizon only; no LOLA mask for this site";
  svg.setAttribute(
    "aria-label",
    `Horizon profile. Sun ${sky.sunElevationDeg.toFixed(1)}° at azimuth ${sky.sunAzimuthDeg.toFixed(0)}°. Earth ${sky.earthElevationDeg.toFixed(1)}° at azimuth ${sky.earthAzimuthDeg.toFixed(0)}°. ${maskNote}.`,
  );

  const samples = mask?.elevationDeg ?? new Array(360).fill(0);
  const terrainMin = Math.min(...samples, sky.sunElevationDeg, sky.earthElevationDeg, -2);
  const terrainMax = Math.max(...samples, sky.sunElevationDeg, sky.earthElevationDeg, 5);
  const minElev = terrainMin - 2;
  const maxElev = terrainMax + 4;

  const xScale = (az: number) => pad.left + (az / 360) * plotW;
  const yScale = (elev: number) =>
    pad.top + plotH - ((elev - minElev) / (maxElev - minElev)) * plotH;

  const ns = "http://www.w3.org/2000/svg";
  const node = (tag: string, attrs: Record<string, string>, text?: string) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    svg.appendChild(el);
    return el;
  };

  for (const az of [0, 90, 180, 270, 360]) {
    node("line", {
      x1: String(xScale(az)),
      x2: String(xScale(az)),
      y1: String(pad.top),
      y2: String(pad.top + plotH),
      stroke: "var(--color-border)",
      "stroke-width": "1",
    });
    const dir = az === 0 || az === 360 ? "N" : az === 90 ? "E" : az === 180 ? "S" : "W";
    node(
      "text",
      {
        x: String(xScale(az)),
        y: String(height - 6),
        fill: "var(--color-text-muted)",
        "font-size": "10",
        "text-anchor": "middle",
      },
      `${dir} ${az === 360 ? 0 : az}°`,
    );
  }

  node("line", {
    x1: String(pad.left),
    x2: String(pad.left + plotW),
    y1: String(yScale(0)),
    y2: String(yScale(0)),
    stroke: "var(--color-text-muted)",
    "stroke-dasharray": "3 3",
    "stroke-width": "1",
  });

  const step = Math.max(1, Math.floor(samples.length / 180));
  const pts: string[] = [`${xScale(0)},${yScale(minElev)}`];
  for (let i = 0; i < samples.length; i += step) {
    const az = (i / samples.length) * 360;
    pts.push(`${xScale(az)},${yScale(samples[i])}`);
  }
  pts.push(`${xScale(360)},${yScale(samples[0])}`);
  pts.push(`${xScale(360)},${yScale(minElev)}`);

  node("polygon", {
    points: pts.join(" "),
    fill: "rgba(161,161,170,0.22)",
    stroke: "var(--color-terrain)",
    "stroke-width": "1.5",
  });

  drawBody(node, xScale, yScale, sky.sunAzimuthDeg, sky.sunElevationDeg, "var(--color-sun)", "Sun");
  drawBody(node, xScale, yScale, sky.earthAzimuthDeg, sky.earthElevationDeg, "var(--color-earth)", "Earth");

  node(
    "text",
    {
      x: "12",
      y: String(pad.top + plotH / 2),
      fill: "var(--color-text-muted)",
      "font-size": "10",
      "text-anchor": "middle",
      transform: `rotate(-90, 12, ${pad.top + plotH / 2})`,
    },
    "Elevation °",
  );
}

function drawBody(
  node: (tag: string, attrs: Record<string, string>, text?: string) => SVGElement,
  xScale: (az: number) => number,
  yScale: (el: number) => number,
  az: number,
  el: number,
  color: string,
  label: string,
) {
  const azimuth = ((az % 360) + 360) % 360;
  node("line", {
    x1: String(xScale(azimuth)),
    x2: String(xScale(azimuth)),
    y1: String(yScale(el)),
    y2: String(yScale(-90)),
    stroke: color,
    "stroke-dasharray": "4 3",
    "stroke-width": "1",
  });
  node("circle", {
    cx: String(xScale(azimuth)),
    cy: String(yScale(el)),
    r: "5",
    fill: color,
  });
  node(
    "text",
    {
      x: String(xScale(azimuth) + 8),
      y: String(yScale(el) - 6),
      fill: color,
      "font-size": "11",
      "font-weight": "600",
    },
    `${label} ${el.toFixed(1)}°`,
  );
}
