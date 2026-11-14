/**
 * Domain contracts for the Lunar Landing Site Navigator science core.
 *
 * These are the typed interfaces and engine entry-point signatures for the
 * deterministic science library (see docs/SCIENCE.md, docs/data-contracts.md).
 * Units carry their names: `epochTdbSec` (TDB seconds past J2000),
 * `elevationDeg` (degrees), `distanceKm` (kilometers), `eastLonDeg` /
 * `latDeg` (degrees), `azimuthDeg` (degrees, clockwise from North). Radians
 * are used only inside tight math helpers and converted at boundaries.
 *
 * Bootstrap milestone: the types are declared and the entry points exist as
 * signatures that throw `NotImplementedError`. No science logic is
 * implemented in this milestone.
 */

/** A surface site on the Moon. */
export interface LunarSite {
  readonly id: string;
  readonly eastLonDeg: number; // degrees, east-positive
  readonly latDeg: number; // degrees, north-positive
}

/** Celestial moment in the internal ephemeris time scale. */
export interface SkyState {
  readonly epochTdbSec: number; // TDB seconds past J2000
  readonly sunAzimuthDeg: number; // degrees, clockwise from North
  readonly sunElevationDeg: number; // degrees, relative to local horizontal
  readonly earthAzimuthDeg: number; // degrees, clockwise from North
  readonly earthElevationDeg: number; // degrees, relative to local horizontal
}

/** Terrain horizon mask for one site. */
export interface HorizonMask {
  readonly siteId: string;
  readonly eastLonDeg: number; // degrees, east-positive
  readonly latDeg: number; // degrees, north-positive
  readonly elevationDeg: readonly number[]; // degrees, one entry per azimuth sample
  readonly status: "ok" | "missing_coverage" | "insufficient_coverage";
}

/** Outcome of checking one mission constraint. Missing data is never "meets". */
export type Verdict = "meets" | "misses" | "unknown";

/** A single mission constraint used by the evaluation and slip-window logic. */
export interface Constraint {
  readonly id: string;
  readonly kind: string;
}

/** Context required to evaluate constraints. */
export interface ConstraintContext {
  readonly skyState: SkyState;
}

/** Result of evaluating one constraint. */
export interface ConstraintVerdict {
  readonly constraintId: string;
  readonly verdict: Verdict;
  readonly reason: string;
}

/** A contiguous time window. */
export interface VisibilityWindow {
  readonly startEpochTdbSec: number;
  readonly endEpochTdbSec: number;
}

/** Input to the slip-window finder. */
export interface SlipWindowInput {
  readonly site: LunarSite;
  readonly dateUtc: string; // ISO-8601 UTC with Z suffix
  readonly constraints: readonly Constraint[];
  readonly dateRangeDays: number;
}

/** A single slip-window candidate outcome. */
export interface SlipWindowCandidate {
  readonly site: LunarSite;
  readonly dateUtc: string;
  readonly verdict: Verdict;
}

/** Result of the slip-window finder. */
export interface SlipWindowResult {
  readonly candidates: readonly SlipWindowCandidate[];
}

/** Error thrown by scaffolded engine entry points that are not implemented yet. */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

/** Compute apparent Sun/Earth azimuth/elevation for a site at an epoch. */
export function skyAt(_site: LunarSite, _epochTdbSec: number): SkyState {
  throw new NotImplementedError("skyAt is not implemented in the app-repo scaffold");
}

/** Compute the terrain horizon mask for a site. */
export function horizonMaskFor(_site: LunarSite, _epochTdbSec: number): HorizonMask {
  throw new NotImplementedError("horizonMaskFor is not implemented in the app-repo scaffold");
}

/** Fraction of a body disc above the horizon mask. */
export function visibleDiscFraction(_site: LunarSite, _epochTdbSec: number): number {
  throw new NotImplementedError("visibleDiscFraction is not implemented in the app-repo scaffold");
}

/** Compute windows with sunlit and Earth-visible conditions. */
export function sunlitAndEarthVisibleWindows(
  _site: LunarSite,
  _epochTdbSec: number,
): readonly VisibilityWindow[] {
  throw new NotImplementedError("sunlitAndEarthVisibleWindows is not implemented in the app-repo scaffold");
}

/** Evaluate constraints against a sky state; missing data is never "meets". */
export function evaluateConstraints(
  _constraints: readonly Constraint[],
  _context: ConstraintContext,
): readonly ConstraintVerdict[] {
  throw new NotImplementedError("evaluateConstraints is not implemented in the app-repo scaffold");
}

/** Find slip windows: candidate sites and dates meeting the constraints. */
export function slipWindowFinder(_input: SlipWindowInput): SlipWindowResult {
  throw new NotImplementedError("slipWindowFinder is not implemented in the app-repo scaffold");
}
