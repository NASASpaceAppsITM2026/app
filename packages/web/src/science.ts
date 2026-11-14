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
