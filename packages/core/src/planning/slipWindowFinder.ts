/**
 * Slip-window finder: `slipWindowFinder`.
 *
 * Scans a date range for candidate site/date combinations that satisfy the
 * supplied mission constraints, returning each candidate with a
 * `meets` / `misses` / `unknown` verdict and a reason string.
 *
 * The finder depends on the configured ephemeris artifact (`skyAt`) and the
 * configured horizon-masks artifact (`horizonMaskFor` / `horizonElevationAt`).
 * It samples the range at a fixed step and evaluates each constraint kind
 * against the computed sky state and horizon mask. Missing data is never
 * `meets`: epochs outside the ephemeris window or sites without a mask are
 * reported as `unknown`.
 *
 * Conventions (AGENTS.md §5, docs/data-contracts.md):
 * - Time: TDB seconds past J2000 (`epochTdbSec`); `dateUtc` is parsed as UTC
 *   and treated as TDB for planning (the UTC↔TDB difference is seconds-level
 *   and immaterial at planning granularity).
 * - Azimuth: degrees clockwise from North. Elevation: degrees above the local
 *   horizontal plane.
 * - Units carried in names: `epochTdbSec`, `sunElevationDeg`, etc.
 */

import {
  type SlipWindowCandidate,
  type SlipWindowInput,
  type SlipWindowResult,
  type SkyState,
  type Verdict,
} from "../contracts";
import { skyAt } from "../ephemeris";
import { horizonElevationAt, horizonMaskFor } from "../terrain";

const SECONDS_PER_DAY = 86_400;
const SAMPLE_STEP_SEC = 30 * 60; // 30-minute planning granularity
const J2000_UTC_MS = 946_684_800_000; // 2000-01-01T12:00:00Z

/** Parse an ISO-8601 UTC `dateUtc` string into TDB seconds past J2000. */
function dateUtcToTdbSec(dateUtc: string): number {
  const ms = Date.parse(dateUtc);
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid dateUtc (expected ISO-8601 UTC with Z suffix): ${dateUtc}`);
  }
  return (ms - J2000_UTC_MS) / 1000;
}

/** Format TDB seconds past J2000 as an ISO-8601 UTC string. */
function tdbSecToUtcIso(epochTdbSec: number): string {
  return new Date(J2000_UTC_MS + epochTdbSec * 1000).toISOString();
}

/**
 * Evaluate one constraint kind against a sky state and horizon mask.
 *
 * Unknown constraint kinds return `unknown` (honest uncertainty) rather than
 * fabricating a pass/fail decision.
 */
function evaluateConstraintKind(
  kind: string,
  skyState: SkyState,
  horizonSunElevationDeg: number,
  horizonEarthElevationDeg: number,
): { verdict: Verdict; reason: string } {
  switch (kind) {
    case "sunAboveHorizon":
      if (skyState.sunElevationDeg > 0) {
        return { verdict: "meets", reason: "Sun above local horizon" };
      }
      return { verdict: "misses", reason: "Sun below local horizon" };
    case "earthAboveHorizon":
      if (skyState.earthElevationDeg > 0) {
        return { verdict: "meets", reason: "Earth above local horizon" };
      }
      return { verdict: "misses", reason: "Earth below local horizon" };
    case "sunAboveMask":
      if (skyState.sunElevationDeg > horizonSunElevationDeg) {
        return { verdict: "meets", reason: "Sun above horizon mask" };
      }
      return { verdict: "misses", reason: "Sun below horizon mask" };
    case "earthAboveMask":
      if (skyState.earthElevationDeg > horizonEarthElevationDeg) {
        return { verdict: "meets", reason: "Earth above horizon mask" };
      }
      return { verdict: "misses", reason: "Earth below horizon mask" };
    default:
      return { verdict: "unknown", reason: `Unrecognized constraint kind: ${kind}` };
  }
}

/** Combine per-constraint verdicts into one overall verdict and reason list. */
function combineVerdicts(results: readonly { verdict: Verdict; reason: string }[]): {
  verdict: Verdict;
  reasons: string[];
} {
  if (results.length === 0) {
    return { verdict: "meets", reasons: ["No constraints evaluated"] };
  }
  let overall: Verdict = "meets";
  let hasUnknown = false;
  const reasons: string[] = [];
  for (const result of results) {
    reasons.push(result.reason);
    if (result.verdict === "misses") {
      overall = "misses";
    } else if (result.verdict === "unknown") {
      hasUnknown = true;
    }
  }
  if (overall === "meets" && hasUnknown) {
    overall = "unknown";
  }
  return { verdict: overall, reasons };
}

/**
 * Find slip windows: candidate dates over `dateRangeDays` starting at
 * `dateUtc` that satisfy the supplied `constraints` for `site`.
 *
 * Bounded candidates and dates: only epochs within the requested range are
 * returned, and only epochs covered by the configured ephemeris window are
 * evaluated (others are `unknown`).
 */
export function slipWindowFinder(input: SlipWindowInput): SlipWindowResult {
  const { site, dateUtc, constraints, dateRangeDays } = input;
  const startTdbSec = dateUtcToTdbSec(dateUtc);
  const endTdbSec = startTdbSec + dateRangeDays * SECONDS_PER_DAY;

  const candidates: SlipWindowCandidate[] = [];
  for (let epochTdbSec = startTdbSec; epochTdbSec <= endTdbSec; epochTdbSec += SAMPLE_STEP_SEC) {
    let skyState: SkyState;
    try {
      skyState = skyAt(site, epochTdbSec);
    } catch {
      candidates.push({
        site,
        dateUtc: tdbSecToUtcIso(epochTdbSec),
        verdict: "unknown",
        reason: "Ephemeris not available for this epoch",
      });
      continue;
    }

    let horizonSunElevationDeg: number;
    let horizonEarthElevationDeg: number;
    try {
      const mask = horizonMaskFor(site);
      if (mask.status !== "ok") {
        candidates.push({
          site,
          dateUtc: tdbSecToUtcIso(epochTdbSec),
          verdict: "unknown",
          reason: `Horizon mask coverage is ${mask.status}; missing data is never "meets"`,
        });
        continue;
      }
      horizonSunElevationDeg = horizonElevationAt(mask, skyState.sunAzimuthDeg);
      horizonEarthElevationDeg = horizonElevationAt(mask, skyState.earthAzimuthDeg);
    } catch {
      candidates.push({
        site,
        dateUtc: tdbSecToUtcIso(epochTdbSec),
        verdict: "unknown",
        reason: "Horizon mask not available for this site",
      });
      continue;
    }

    const perConstraint = constraints.map((constraint) =>
      evaluateConstraintKind(
        constraint.kind,
        skyState,
        horizonSunElevationDeg,
        horizonEarthElevationDeg,
      ),
    );
    const { verdict, reasons } = combineVerdicts(perConstraint);

    candidates.push({
      site,
      dateUtc: tdbSecToUtcIso(epochTdbSec),
      verdict,
      reason: reasons.join("; "),
    });
  }

  return { candidates };
}
