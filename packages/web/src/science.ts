/**
 * UI adapters around the core science library.
 * Evaluates ephemeris (DE440 Chebyshev fits) and LOLA terrain horizon masks.
 * Falls back to mocks only when pipeline artifacts are not loaded.
 */

import type { Constraint, HorizonMask, LunarSite, SkyState, Verdict } from "core";
import { mockHorizonMaskFor, mockSkyAt } from "./mocks";
import { PRESET_SITES } from "./scenario";

const J2000_UTC_MS = 946_684_800_000;

export interface ScienceStatus {
  readonly ephemeris: boolean;
  readonly masks: boolean;
}

export function getScienceStatus(): ScienceStatus {
  if (typeof window === "undefined") {
    return { ephemeris: false, masks: false };
  }
  const configured = (window as unknown as { __scienceConfigured?: ScienceStatus }).__scienceConfigured;
  return configured ?? { ephemeris: false, masks: false };
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
    try {
      const { ephemerisSkyAt } = await import("core");
      return ephemerisSkyAt(site, utcToTdbSec(dateUtc, hourUtc));
    } catch (e) {
      console.warn("ephemerisSkyAt failed, falling back to mock:", e);
    }
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
      // If no exact match and coordinates not within 0.05 deg, return null to show sphere horizon
      return { mask: null, source: "missing" };
    }
  }
  return { mask: mockHorizonMaskFor(site), source: "mock" };
}

export function maskElevationAt(mask: HorizonMask | null, azimuthDeg: number): number {
  if (!mask || !mask.elevationDeg || mask.elevationDeg.length === 0) {
    // Spherical lunar horizon with 2m observer height: dip angle = -0.0869°
    return -0.0869;
  }
  const samples = mask.elevationDeg;
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
        return row(constraint.kind, label, sky.sunElevationDeg > 0, "Sun vs spherical horizon (0°)");
      case "earthAboveHorizon":
        return row(constraint.kind, label, sky.earthElevationDeg > 0, "Earth vs spherical horizon (0°)");
      case "sunAboveMask": {
        const elev = maskElevationAt(mask, sky.sunAzimuthDeg);
        const diff = (sky.sunElevationDeg - elev).toFixed(1);
        const sign = sky.sunElevationDeg >= elev ? "+" : "";
        const desc = mask
          ? `Sun ${sky.sunElevationDeg.toFixed(1)}° vs terrain ${elev.toFixed(1)}° (${sign}${diff}°)`
          : `Sun ${sky.sunElevationDeg.toFixed(1)}° vs sphere horizon ${elev.toFixed(1)}°`;
        return row(constraint.kind, label, sky.sunElevationDeg > elev, desc);
      }
      case "earthAboveMask": {
        const elev = maskElevationAt(mask, sky.earthAzimuthDeg);
        const diff = (sky.earthElevationDeg - elev).toFixed(1);
        const sign = sky.earthElevationDeg >= elev ? "+" : "";
        const desc = mask
          ? `Earth ${sky.earthElevationDeg.toFixed(1)}° vs terrain ${elev.toFixed(1)}° (${sign}${diff}°)`
          : `Earth ${sky.earthElevationDeg.toFixed(1)}° vs sphere horizon ${elev.toFixed(1)}°`;
        return row(constraint.kind, label, sky.earthElevationDeg > elev, desc);
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
      return "Sun above local horizon";
    case "earthAboveHorizon":
      return "Earth above local horizon";
    case "sunAboveMask":
      return "Sun above terrain silhouette";
    case "earthAboveMask":
      return "Earth direct comms above terrain";
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
  const { mask } = await horizonMaskForSite(site);

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

/** Diurnal hourly sample for timeline visualization. */
export interface DiurnalHourSample {
  readonly hourUtc: number;
  readonly sunElevationDeg: number;
  readonly sunAzimuthDeg: number;
  readonly earthElevationDeg: number;
  readonly earthAzimuthDeg: number;
  readonly sunlit: boolean;
  readonly earthVisible: boolean;
  readonly powerProxy: number;
  readonly verdict: Verdict;
}

export interface DiurnalTimelineResult {
  readonly hours: readonly DiurnalHourSample[];
  readonly sunlitHours: number;
  readonly earthVisibleHours: number;
  readonly countdownSun: string;
  readonly countdownEarth: string;
  readonly nextSuitableHour?: number;
}

/**
 * Computes a 24-hour diurnal profile across the selected date at 1-hour resolution.
 */
export async function calculateDiurnalTimeline(
  site: LunarSite,
  dateUtc: string,
  currentHourUtc: number,
  constraints: readonly Constraint[],
): Promise<DiurnalTimelineResult> {
  const { mask } = await horizonMaskForSite(site);
  const hours: DiurnalHourSample[] = [];
  let sunlitCount = 0;
  let earthVisibleCount = 0;

  for (let h = 0; h < 24; h++) {
    const sky = await skyAtForDate(site, dateUtc, h);
    const sunMaskElev = maskElevationAt(mask, sky.sunAzimuthDeg);
    const earthMaskElev = maskElevationAt(mask, sky.earthAzimuthDeg);

    const sunlit = sky.sunElevationDeg > sunMaskElev;
    const earthVisible = sky.earthElevationDeg > earthMaskElev;
    const power = horizontalPowerProxy(sky.sunElevationDeg, sunlit);

    if (sunlit) sunlitCount++;
    if (earthVisible) earthVisibleCount++;

    const rows = evaluateUiConstraints(constraints, sky, mask);
    let verdict: Verdict = "meets";
    if (rows.some((r) => r.verdict === "misses")) verdict = "misses";
    else if (rows.some((r) => r.verdict === "unknown")) verdict = "unknown";
    if (constraints.length === 0) verdict = "meets";

    hours.push({
      hourUtc: h,
      sunElevationDeg: sky.sunElevationDeg,
      sunAzimuthDeg: sky.sunAzimuthDeg,
      earthElevationDeg: sky.earthElevationDeg,
      earthAzimuthDeg: sky.earthAzimuthDeg,
      sunlit,
      earthVisible,
      powerProxy: power,
      verdict,
    });
  }

  // Countdowns relative to currentHourUtc
  const currentSample = hours[currentHourUtc] ?? hours[12];
  let countdownSun = "Continuous Daylight";
  if (sunlitCount === 0) {
    countdownSun = "Continuous Dark (Shadowed)";
  } else if (sunlitCount === 24) {
    countdownSun = "Continuous Daylight (24h+)";
  } else if (currentSample.sunlit) {
    // Find next sunset
    let hoursLeft = 0;
    for (let i = 1; i <= 24; i++) {
      const idx = (currentHourUtc + i) % 24;
      if (!hours[idx].sunlit) {
        hoursLeft = i;
        break;
      }
    }
    countdownSun = `Sunset in ~${hoursLeft}h`;
  } else {
    // Find next sunrise
    let hoursLeft = 0;
    for (let i = 1; i <= 24; i++) {
      const idx = (currentHourUtc + i) % 24;
      if (hours[idx].sunlit) {
        hoursLeft = i;
        break;
      }
    }
    countdownSun = `Sunrise in ~${hoursLeft}h`;
  }

  let countdownEarth = "Direct Line of Sight Active";
  if (earthVisibleCount === 0) {
    countdownEarth = "Comms Blocked by Terrain";
  } else if (earthVisibleCount === 24) {
    countdownEarth = "Continuous Comms (24h+)";
  } else if (currentSample.earthVisible) {
    let hoursLeft = 0;
    for (let i = 1; i <= 24; i++) {
      const idx = (currentHourUtc + i) % 24;
      if (!hours[idx].earthVisible) {
        hoursLeft = i;
        break;
      }
    }
    countdownEarth = `Comms LOS in ~${hoursLeft}h`;
  } else {
    let hoursLeft = 0;
    for (let i = 1; i <= 24; i++) {
      const idx = (currentHourUtc + i) % 24;
      if (hours[idx].earthVisible) {
        hoursLeft = i;
        break;
      }
    }
    countdownEarth = `Comms AOS in ~${hoursLeft}h`;
  }

  // Next suitable hour with 'meets' verdict
  let nextSuitableHour: number | undefined;
  for (let i = 1; i <= 24; i++) {
    const idx = (currentHourUtc + i) % 24;
    if (hours[idx].verdict === "meets") {
      nextSuitableHour = idx;
      break;
    }
  }

  return {
    hours,
    sunlitHours: sunlitCount,
    earthVisibleHours: earthVisibleCount,
    countdownSun,
    countdownEarth,
    nextSuitableHour,
  };
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
  // Convert km to degrees (approximate: 1° ≈ 30.3 km on Moon equator)
  const kmPerDegLat = 30.32;
  const cosLat = Math.cos((site.latDeg * Math.PI) / 180);
  const kmPerDegLon = kmPerDegLat * Math.max(0.01, cosLat);
  const dLat = radiusKm / kmPerDegLat;
  const dLon = radiusKm / kmPerDegLon;

  // Grid spacing: ~1 km steps, capped at 100 points total
  const stepDeg = Math.max(0.02, Math.min(dLat, dLon) / 5);
  const points: Array<{ latDeg: number; lonDeg: number }> = [];

  for (let lat = site.latDeg - dLat; lat <= site.latDeg + dLat; lat += stepDeg) {
    for (let lon = site.eastLonDeg - dLon; lon <= site.eastLonDeg + dLon; lon += stepDeg) {
      const dLatKm = (lat - site.latDeg) * kmPerDegLat;
      const dLonKm = (lon - site.eastLonDeg) * kmPerDegLon;
      if (Math.hypot(dLatKm, dLonKm) <= radiusKm) {
        points.push({ latDeg: lat, lonDeg: lon });
      }
    }
  }

  // Cap points to avoid long calculation loops
  const maxPoints = 80;
  if (points.length > maxPoints) {
    const step = Math.ceil(points.length / maxPoints);
    const sampled = points.filter((_, i) => i % step === 0);
    points.length = 0;
    points.push(...sampled);
  }

  let meets = 0,
    misses = 0,
    unknown = 0;
  let sunElevMin = Infinity,
    sunElevMax = -Infinity;
  let earthElevMin = Infinity,
    earthElevMax = -Infinity;

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
    sunElevMin: Number.isFinite(sunElevMin) ? sunElevMin : 0,
    sunElevMax: Number.isFinite(sunElevMax) ? sunElevMax : 0,
    earthElevMin: Number.isFinite(earthElevMin) ? earthElevMin : 0,
    earthElevMax: Number.isFinite(earthElevMax) ? earthElevMax : 0,
    gridPoints: points.length,
  };
}

/**
 * Stay duration + best arrival day.
 * Scans a date range for the best landing day given a stay duration.
 * The best day is the one where, over the entire stay period, the site has
 * the highest average sunlight and Earth visibility.
 */
export interface StayWindowCandidate {
  readonly dateUtc: string;
  readonly stayDays: number;
  readonly avgSunElevationDeg: number;
  readonly avgEarthElevationDeg: number;
  readonly sunlitDays: number;
  readonly earthVisibleDays: number;
  readonly meetsConstraints: boolean;
  readonly score: number; // 0-100 composite score
}

export async function findBestArrivalDay(
  site: LunarSite,
  startDateUtc: string,
  endDateUtc: string,
  stayDays: number,
  hourUtc: number,
  constraints: readonly Constraint[],
): Promise<StayWindowCandidate[]> {
  const { mask } = await horizonMaskForSite(site);
  const startMs = Date.parse(`${startDateUtc}T00:00:00Z`);
  const endMs = Date.parse(`${endDateUtc}T00:00:00Z`);
  const candidates: StayWindowCandidate[] = [];

  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    const dateUtc = new Date(ms).toISOString().slice(0, 10);
    let totalSunElev = 0;
    let totalEarthElev = 0;
    let sunlitDays = 0;
    let earthVisibleDays = 0;
    let allMeet = true;

    for (let d = 0; d < stayDays; d++) {
      const dayMs = ms + d * 86_400_000;
      const dayDate = new Date(dayMs).toISOString().slice(0, 10);
      let sky: SkyState;
      try {
        sky = await skyAtForDate(site, dayDate, hourUtc);
      } catch {
        allMeet = false;
        break;
      }

      totalSunElev += sky.sunElevationDeg;
      totalEarthElev += sky.earthElevationDeg;

      const sunMaskElev = maskElevationAt(mask, sky.sunAzimuthDeg);
      const earthMaskElev = maskElevationAt(mask, sky.earthAzimuthDeg);

      if (sky.sunElevationDeg > sunMaskElev) sunlitDays++;
      if (sky.earthElevationDeg > earthMaskElev) earthVisibleDays++;

      const rows = evaluateUiConstraints(constraints, sky, mask);
      if (rows.some((r) => r.verdict === "misses")) allMeet = false;
    }

    if (!Number.isFinite(totalSunElev)) continue;

    const avgSunElev = totalSunElev / stayDays;
    const avgEarthElev = totalEarthElev / stayDays;

    // Score: weighted composite (0-100)
    // Sunlight: 40% weight (higher elevation = better)
    // Earth comms: 30% weight (higher elevation = better)
    // Constraint meets: 30% weight (binary bonus)
    const sunScore = Math.max(0, Math.min(100, (avgSunElev + 2) * 10)); // -2° to +8° maps to 0-100
    const earthScore = Math.max(0, Math.min(100, (avgEarthElev + 2) * 10));
    const constraintScore = allMeet ? 100 : 0;
    const score = Math.round(sunScore * 0.4 + earthScore * 0.3 + constraintScore * 0.3);

    candidates.push({
      dateUtc,
      stayDays,
      avgSunElevationDeg: avgSunElev,
      avgEarthElevationDeg: avgEarthElev,
      sunlitDays,
      earthVisibleDays,
      meetsConstraints: allMeet,
      score,
    });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * Weighted multi-criteria site scoring.
 * Evaluates all preset sites at a given date and returns ranked results.
 */
export interface SiteScoreCriteria {
  readonly communication: number; // weight 1-5
  readonly sunlight: number; // weight 1-5
  readonly flatness: number; // weight 1-5 (placeholder — no terrain slope data)
  readonly roughness: number; // weight 1-5 (placeholder — no terrain slope data)
  readonly missionObjective: number; // weight 1-5 (e.g. south pole proximity)
}

export interface SiteScoreResult {
  readonly site: LunarSite;
  readonly scores: {
    readonly communication: number;
    readonly sunlight: number;
    readonly flatness: number;
    readonly roughness: number;
    readonly missionObjective: number;
  };
  readonly weightedScore: number; // 0-100
  readonly sunElevationDeg: number;
  readonly earthElevationDeg: number;
  readonly sunAboveMask: boolean;
  readonly earthAboveMask: boolean;
}

export async function scoreSites(
  dateUtc: string,
  hourUtc: number,
  criteria: SiteScoreCriteria,
  constraints: readonly Constraint[],
): Promise<SiteScoreResult[]> {
  const results: SiteScoreResult[] = [];

  for (const site of PRESET_SITES) {
    let sky: SkyState;
    try {
      sky = await skyAtForDate(site, dateUtc, hourUtc);
    } catch {
      continue;
    }

    const { mask } = await horizonMaskForSite(site);
    const sunMaskElev = maskElevationAt(mask, sky.sunAzimuthDeg);
    const earthMaskElev = maskElevationAt(mask, sky.earthAzimuthDeg);
    const sunAboveMask = sky.sunElevationDeg > sunMaskElev;
    const earthAboveMask = sky.earthElevationDeg > earthMaskElev;

    // Communication score: based on Earth elevation above mask
    const commRaw = Math.max(0, Math.min(100, (sky.earthElevationDeg - earthMaskElev + 2) * 10));

    // Sunlight score: based on Sun elevation above mask
    const sunRaw = Math.max(0, Math.min(100, (sky.sunElevationDeg - sunMaskElev + 2) * 10));

    // Flatness & roughness: placeholder (no slope data available)
    // Use a neutral score based on latitude (equatorial sites tend to be flatter)
    const absLat = Math.abs(site.latDeg);
    const flatnessRaw = Math.max(0, 100 - absLat * 0.5); // simpler terrain near equator
    const roughnessRaw = Math.max(0, 100 - absLat * 0.3);

    // Mission objective: south pole proximity (for Artemis-style missions)
    const southPoleProximity = Math.max(0, 100 - (90 + site.latDeg) * 1.5); // closer to -90 = higher score

    // Weighted composite
    const totalWeight =
      criteria.communication +
      criteria.sunlight +
      criteria.flatness +
      criteria.roughness +
      criteria.missionObjective;

    const weightedScore = totalWeight > 0
      ? Math.round(
          (commRaw * criteria.communication +
            sunRaw * criteria.sunlight +
            flatnessRaw * criteria.flatness +
            roughnessRaw * criteria.roughness +
            southPoleProximity * criteria.missionObjective) / totalWeight
        )
      : 0;

    results.push({
      site,
      scores: {
        communication: Math.round(commRaw),
        sunlight: Math.round(sunRaw),
        flatness: Math.round(flatnessRaw),
        roughness: Math.round(roughnessRaw),
        missionObjective: Math.round(southPoleProximity),
      },
      weightedScore,
      sunElevationDeg: sky.sunElevationDeg,
      earthElevationDeg: sky.earthElevationDeg,
      sunAboveMask,
      earthAboveMask,
    });
  }

  // Sort by weighted score descending
  results.sort((a, b) => b.weightedScore - a.weightedScore);
  return results;
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
    SITE_COORD: `${lon.toFixed(4)},${site.latDeg.toFixed(4)},0`,
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
