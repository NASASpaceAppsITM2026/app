/**
 * Mock implementations of core science functions.
 *
 * These replace the real `core` functions so the UI works without
 * configured ephemeris or terrain artifacts. The mocks return
 * deterministic, plausible values that exercise every UI path
 * (sun above/below horizon, Earth visible/obscured, terrain mask).
 *
 * Once real artifacts are configured, swap these out for the actual
 * `core` imports.
 */

import type { HorizonMask, LunarSite, SkyState, SlipWindowInput, SlipWindowResult, Verdict } from "core";

/**
 * Mock skyAt — returns a smooth sinusoidal Sun/Earth position.
 * The values are deterministic for a given site + date so the UI
 * renders consistently.
 */
export function mockSkyAt(site: LunarSite, dateUtc: string): SkyState {
  // Derive a seed from the site and date for deterministic output
  const dayMs = Date.parse(`${dateUtc}T12:00:00Z`);
  const seed = Math.sin(dayMs / 86400000 + site.latDeg * 0.1 + site.eastLonDeg * 0.05);

  // Sun elevation oscillates between -15° and +45° (polar site pattern)
  const sunElevationDeg = 15 + seed * 30;
  const sunAzimuthDeg = (180 + seed * 180) % 360;

  // Earth elevation oscillates between -5° and +35°
  const earthElevationDeg = 15 + Math.cos(seed * 2.1) * 20;
  const earthAzimuthDeg = (270 + Math.cos(seed) * 90) % 360;

  // Approximate TDB epoch (not critical for mock)
  const epochTdbSec = (dayMs - 946_684_800_000) / 1000;

  return {
    epochTdbSec,
    sunAzimuthDeg,
    sunElevationDeg,
    earthAzimuthDeg,
    earthElevationDeg,
  };
}

/**
 * Mock horizonMaskFor — returns a terrain mask with a few peaks.
 * Simulates crater rim obstruction at a polar site.
 */
export function mockHorizonMaskFor(site: LunarSite): HorizonMask {
  const n = 360; // 1° resolution
  const elevationDeg: number[] = [];

  for (let az = 0; az < n; az++) {
    // Base horizon at 0°, with a few peaks simulating crater rims
    const base = -2 + Math.sin(az * Math.PI / 180 * 3) * 3;
    const peak1 = Math.exp(-0.5 * Math.pow((az - 45) / 15, 2)) * 8;
    const peak2 = Math.exp(-0.5 * Math.pow((az - 200) / 20, 2)) * 6;
    const peak3 = Math.exp(-0.5 * Math.pow((az - 310) / 10, 2)) * 5;
    // Slight variation by latitude (polar sites have more obstruction)
    const polarFactor = 1 + Math.abs(site.latDeg) / 90;
    elevationDeg.push((base + peak1 + peak2 + peak3) * polarFactor);
  }

  return {
    siteId: site.id,
    eastLonDeg: site.eastLonDeg,
    latDeg: site.latDeg,
    elevationDeg,
    status: "ok",
  };
}

/**
 * Mock slipWindowFinder — scans dates and returns meets/misses/unknown.
 */
export function mockSlipWindowFinder(input: SlipWindowInput): SlipWindowResult {
  const { site, dateUtc, constraints, dateRangeDays } = input;
  const candidates = [];

  const startDate = new Date(`${dateUtc}T00:00:00Z`);
  for (let day = 0; day <= dateRangeDays; day++) {
    const candidateDate = new Date(startDate);
    candidateDate.setDate(candidateDate.getDate() + day);
    const dateStr = candidateDate.toISOString().slice(0, 10);

    const sky = mockSkyAt(site, dateStr);
    const mask = mockHorizonMaskFor(site);

    // Evaluate constraints
    let verdict: Verdict = "meets";
    const reasons: string[] = [];

    for (const constraint of constraints) {
      switch (constraint.kind) {
        case "sunAboveHorizon":
          if (sky.sunElevationDeg > 0) {
            reasons.push("Sun above horizon");
          } else {
            verdict = "misses";
            reasons.push("Sun below horizon");
          }
          break;
        case "earthAboveHorizon":
          if (sky.earthElevationDeg > 0) {
            reasons.push("Earth above horizon");
          } else {
            verdict = "misses";
            reasons.push("Earth below horizon");
          }
          break;
        case "sunAboveMask": {
          const sunAz = Math.round(sky.sunAzimuthDeg) % 360;
          const maskElev = mask.elevationDeg[sunAz] ?? 0;
          if (sky.sunElevationDeg > maskElev) {
            reasons.push("Sun above terrain mask");
          } else {
            verdict = "misses";
            reasons.push("Sun below terrain mask");
          }
          break;
        }
        case "earthAboveMask": {
          const earthAz = Math.round(sky.earthAzimuthDeg) % 360;
          const maskElev = mask.elevationDeg[earthAz] ?? 0;
          if (sky.earthElevationDeg > maskElev) {
            reasons.push("Earth above terrain mask");
          } else {
            verdict = "misses";
            reasons.push("Earth below terrain mask");
          }
          break;
        }
        default:
          verdict = "unknown";
          reasons.push(`Unknown constraint: ${constraint.kind}`);
      }
    }

    candidates.push({
      site,
      dateUtc: dateStr,
      verdict,
      reason: reasons.join("; "),
    });
  }

  return { candidates };
}
