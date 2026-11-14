/**
 * UI adapters around the core science library.
 * Falls back to mocks only when pipeline artifacts are not loaded.
 */

import type { Constraint, HorizonMask, LunarSite, SkyState, Verdict } from "core";
import { mockHorizonMaskFor, mockSkyAt } from "./mocks";

const J2000_UTC_MS = 946_684_800_000;

export interface ScienceStatus {
  readonly ephemeris: boolean;
  readonly masks: boolean;
}

export function getScienceStatus(): ScienceStatus {
  return (
    (window as unknown as { __scienceConfigured?: ScienceStatus }).__scienceConfigured ?? {
      ephemeris: false,
      masks: false,
    }
  );
}

export function utcToTdbSec(dateUtc: string, hourUtc: number): number {
  const hour = Math.max(0, Math.min(23, Math.floor(hourUtc)));
  const stamp = `${dateUtc}T${String(hour).padStart(2, "0")}:00:00Z`;
  const ms = Date.parse(stamp);
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid UTC date/hour: ${stamp}`);
  }
  return (ms - J2000_UTC_MS) / 1000;
}

export function tdbSecToIsoDate(epochTdbSec: number): string {
  return new Date(J2000_UTC_MS + epochTdbSec * 1000).toISOString().slice(0, 10);
}

export async function skyAtForDate(site: LunarSite, dateUtc: string, hourUtc: number): Promise<SkyState> {
  const status = getScienceStatus();
  if (status.ephemeris) {
    const { ephemerisSkyAt } = await import("core");
    return ephemerisSkyAt(site, utcToTdbSec(dateUtc, hourUtc));
  }
  return mockSkyAt(site, dateUtc);
}

export interface MaskLookup {
  readonly mask: HorizonMask | null;
  readonly source: "artifact" | "mock" | "missing";
}

export async function horizonMaskForSite(site: LunarSite): Promise<MaskLookup> {
  const status = getScienceStatus();
  if (status.masks) {
    try {
      const { coreHorizonMaskFor } = await import("core");
      return { mask: coreHorizonMaskFor(site), source: "artifact" };
    } catch {
      return { mask: null, source: "missing" };
    }
  }
  return { mask: mockHorizonMaskFor(site), source: "mock" };
}

export function maskElevationAt(mask: HorizonMask, azimuthDeg: number): number {
  const samples = mask.elevationDeg;
  if (samples.length === 0) return 0;
  const az = ((azimuthDeg % 360) + 360) % 360;
  const step = 360 / samples.length;
  const index = az / step;
  const i0 = Math.floor(index) % samples.length;
  const i1 = (i0 + 1) % samples.length;
  const f = index - Math.floor(index);
  return samples[i0] * (1 - f) + samples[i1] * f;
}

/** Cosine of incidence on a local-horizontal panel. Not a full power model. */
export function horizontalPowerProxy(sunElevationDeg: number, sunAboveMask: boolean): number {
  if (!sunAboveMask || sunElevationDeg <= 0) return 0;
  return Math.sin((sunElevationDeg * Math.PI) / 180);
}

export interface ConstraintRow {
  readonly kind: string;
  readonly label: string;
  readonly verdict: Verdict;
  readonly reason: string;
}

export function evaluateUiConstraints(
  constraints: readonly Constraint[],
  sky: SkyState,
  mask: HorizonMask | null,
): ConstraintRow[] {
  return constraints.map((constraint) => {
    const label = constraintLabel(constraint.kind);
    switch (constraint.kind) {
      case "sunAboveHorizon":
        return row(constraint.kind, label, sky.sunElevationDeg > 0, "Sun vs local horizontal");
      case "earthAboveHorizon":
        return row(constraint.kind, label, sky.earthElevationDeg > 0, "Earth vs local horizontal");
      case "sunAboveMask": {
        if (!mask) return unknownRow(constraint.kind, label, "No LOLA horizon mask for this site");
        const elev = maskElevationAt(mask, sky.sunAzimuthDeg);
        return row(constraint.kind, label, sky.sunElevationDeg > elev, `Sun ${sky.sunElevationDeg.toFixed(1)}° vs mask ${elev.toFixed(1)}°`);
      }
      case "earthAboveMask": {
        if (!mask) return unknownRow(constraint.kind, label, "No LOLA horizon mask for this site");
        const elev = maskElevationAt(mask, sky.earthAzimuthDeg);
        return row(constraint.kind, label, sky.earthElevationDeg > elev, `Earth ${sky.earthElevationDeg.toFixed(1)}° vs mask ${elev.toFixed(1)}°`);
      }
      default:
        return unknownRow(constraint.kind, label, `Unrecognized constraint: ${constraint.kind}`);
    }
  });
}

function row(kind: string, label: string, meets: boolean, reason: string): ConstraintRow {
  return {
    kind,
    label,
    verdict: meets ? "meets" : "misses",
    reason: meets ? `${reason} — meets` : `${reason} — misses`,
  };
}

function unknownRow(kind: string, label: string, reason: string): ConstraintRow {
  return { kind, label, verdict: "unknown", reason };
}

export function constraintLabel(kind: string): string {
  switch (kind) {
    case "sunAboveHorizon":
      return "Sun above horizon";
    case "earthAboveHorizon":
      return "Earth above horizon";
    case "sunAboveMask":
      return "Sun above terrain";
    case "earthAboveMask":
      return "Earth above terrain";
    default:
      return kind;
  }
}

export interface DaySample {
  readonly dateUtc: string;
  readonly verdict: Verdict;
  readonly sunElevationDeg: number;
  readonly earthElevationDeg: number;
}

export async function sampleDailyWindows(
  site: LunarSite,
  dateUtc: string,
  hourUtc: number,
  days: number,
  constraints: readonly Constraint[],
): Promise<readonly DaySample[]> {
  const samples: DaySample[] = [];
  const start = Date.parse(`${dateUtc}T00:00:00Z`);
  for (let day = 0; day <= days; day += 1) {
    const stamp = new Date(start + day * 86_400_000).toISOString().slice(0, 10);
    let sky: SkyState;
    try {
      sky = await skyAtForDate(site, stamp, hourUtc);
    } catch {
      samples.push({
        dateUtc: stamp,
        verdict: "unknown",
        sunElevationDeg: Number.NaN,
        earthElevationDeg: Number.NaN,
      });
      continue;
    }
    const { mask } = await horizonMaskForSite(site);
    const rows = evaluateUiConstraints(constraints, sky, mask);
    let verdict: Verdict = "meets";
    if (rows.some((r) => r.verdict === "misses")) verdict = "misses";
    else if (rows.some((r) => r.verdict === "unknown")) verdict = "unknown";
    if (constraints.length === 0) verdict = "meets";
    samples.push({
      dateUtc: stamp,
      verdict,
      sunElevationDeg: sky.sunElevationDeg,
      earthElevationDeg: sky.earthElevationDeg,
    });
  }
  return samples;
}

/**
 * Landing-area robustness check.
 * Answers: "Would the plan still work if the lander touched down a little away from the target?"
 * Checks a grid of points within `radiusKm` of the target site and evaluates constraints at each.
 */
export interface LandingAreaResult {
  readonly total: number;
  readonly meets: number;
  readonly misses: number;
  readonly unknown: number;
  readonly sunElevMin: number;
  readonly sunElevMax: number;
  readonly earthElevMin: number;
  readonly earthElevMax: number;
  readonly gridPoints: number;
}

export async function checkLandingArea(
  site: LunarSite,
  dateUtc: string,
  hourUtc: number,
  radiusKm: number,
  constraints: readonly Constraint[],
): Promise<LandingAreaResult> {
  // Convert km to degrees (approximate: 1° ≈ 29.7 km at equator, less at poles)
  const kmPerDegLat = 29.7;
  const kmPerDegLon = 29.7 * Math.cos((site.latDeg * Math.PI) / 180);
  const dLat = radiusKm / kmPerDegLat;
  const dLon = kmPerDegLon > 0.1 ? radiusKm / kmPerDegLon : dLat * 2;

  // Grid spacing: ~1 km steps, capped at 100 points total
  const stepDeg = Math.max(0.05, Math.min(dLat, dLon) / 5);
  const points: Array<{ latDeg: number; lonDeg: number }> = [];

  for (let lat = site.latDeg - dLat; lat <= site.latDeg + dLat; lat += stepDeg) {
    for (let lon = site.eastLonDeg - dLon; lon <= site.eastLonDeg + dLon; lon += stepDeg) {
      // Check distance in km
      const dLatKm = (lat - site.latDeg) * kmPerDegLat;
      const dLonKm = (lon - site.eastLonDeg) * kmPerDegLon;
      if (Math.hypot(dLatKm, dLonKm) <= radiusKm) {
        points.push({ latDeg: lat, lonDeg: lon });
      }
    }
  }

  // Cap points to avoid long waits
  const maxPoints = 100;
  if (points.length > maxPoints) {
    const step = Math.ceil(points.length / maxPoints);
    const sampled = points.filter((_, i) => i % step === 0);
    points.length = 0;
    points.push(...sampled);
  }

  let meets = 0, misses = 0, unknown = 0;
  let sunElevMin = Infinity, sunElevMax = -Infinity;
  let earthElevMin = Infinity, earthElevMax = -Infinity;

  for (const pt of points) {
    const ptSite: LunarSite = { id: "area-check", eastLonDeg: pt.lonDeg, latDeg: pt.latDeg };
    let sky: SkyState;
    try {
      sky = await skyAtForDate(ptSite, dateUtc, hourUtc);
    } catch {
      unknown++;
      continue;
    }

    sunElevMin = Math.min(sunElevMin, sky.sunElevationDeg);
    sunElevMax = Math.max(sunElevMax, sky.sunElevationDeg);
    earthElevMin = Math.min(earthElevMin, sky.earthElevationDeg);
    earthElevMax = Math.max(earthElevMax, sky.earthElevationDeg);

    const { mask } = await horizonMaskForSite(ptSite);
    const rows = evaluateUiConstraints(constraints, sky, mask);
    let verdict: Verdict = "meets";
    if (rows.some((r) => r.verdict === "misses")) verdict = "misses";
    else if (rows.some((r) => r.verdict === "unknown")) verdict = "unknown";
    if (constraints.length === 0) verdict = "meets";

    if (verdict === "meets") meets++;
    else if (verdict === "misses") misses++;
    else unknown++;
  }

  const total = meets + misses + unknown;
  return {
    total,
    meets,
    misses,
    unknown,
    sunElevMin: isFinite(sunElevMin) ? sunElevMin : 0,
    sunElevMax: isFinite(sunElevMax) ? sunElevMax : 0,
    earthElevMin: isFinite(earthElevMin) ? earthElevMin : 0,
    earthElevMax: isFinite(earthElevMax) ? earthElevMax : 0,
    gridPoints: points.length,
  };
}

/** Horizons observer query for quantity 4 (azimuth/elevation), airless surface site. */
export function horizonsVerifyUrl(site: LunarSite, dateUtc: string, target: "sun" | "earth"): string {
  const command = target === "sun" ? "10" : "399";
  const lon = ((site.eastLonDeg % 360) + 360) % 360;
  const params = new URLSearchParams({
    format: "text",
    COMMAND: command,
    CENTER: "coord@301",
    COORD_TYPE: "GEODETIC",
    SITE_COORD: `${lon},${site.latDeg},0`,
    MAKE_EPHEM: "YES",
    EPHEM_TYPE: "OBSERVER",
    QUANTITIES: "4",
    START_TIME: `${dateUtc} 00:00:00`,
    STOP_TIME: `${dateUtc} 23:59:00`,
    STEP_SIZE: "1h",
    CSV_FORMAT: "YES",
    TIME_DIGITS: "FRACSEC",
  });
  return `https://ssd.jpl.nasa.gov/api/horizons.api?${params.toString()}`;
}
