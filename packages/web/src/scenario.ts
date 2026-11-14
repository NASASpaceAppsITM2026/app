/**
 * ScenarioState — URL-serializable representation of the current navigation scenario.
 *
 * A scenario captures the site, date, and constraints the user is exploring.
 * It serializes to a compact query-string fragment so the URL can be shared
 * without credentials, private notes, or large datasets.
 *
 * Conventions:
 * - Versioned so future schema changes remain backward-compatible.
 * - No secrets, no large arrays. Only scalar values.
 * - Units carried in names: `latDeg`, `lonDeg`, `dateUtc`.
 */

import type { Constraint, LunarSite } from "core";

/** Version of the ScenarioState serialization format. */
const SCENARIO_VERSION = "1";

/** Default site: Shackleton crater rim (lunar south pole candidate). */
export const DEFAULT_SITE: LunarSite = {
  id: "shackleton-rim",
  eastLonDeg: 11.3,
  latDeg: -89.5,
};

/** Default date: near the project's reference window. */
export const DEFAULT_DATE = "2026-06-15";

/** Default constraints: sun above horizon + Earth above horizon. */
export const DEFAULT_CONSTRAINTS: Constraint[] = [
  { id: "sun-light", kind: "sunAboveHorizon" },
  { id: "earth-comms", kind: "earthAboveHorizon" },
];

/** Full scenario state held in memory. */
export interface ScenarioState {
  readonly version: string;
  readonly site: LunarSite;
  readonly dateUtc: string; // ISO-8601 date YYYY-MM-DD
  readonly constraints: readonly Constraint[];
}

/** Default scenario. */
export function defaultScenario(): ScenarioState {
  return {
    version: SCENARIO_VERSION,
    site: DEFAULT_SITE,
    dateUtc: DEFAULT_DATE,
    constraints: DEFAULT_CONSTRAINTS,
  };
}

/**
 * Serialize a ScenarioState to a URL query-string object.
 * Keys are short to keep URLs readable.
 */
export function scenarioToQuery(state: ScenarioState): Record<string, string> {
  return {
    v: state.version,
    site: state.site.id,
    lon: state.site.eastLonDeg.toFixed(4),
    lat: state.site.latDeg.toFixed(4),
    date: state.dateUtc,
    constraints: state.constraints.map((c) => c.kind).join(","),
  };
}

/**
 * Build a full shareable URL from the current origin and a ScenarioState.
 */
export function scenarioToUrl(state: ScenarioState): string {
  const params = new URLSearchParams(scenarioToQuery(state));
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

/** Known preset sites for quick selection. */
export const PRESET_SITES: LunarSite[] = [
  { id: "shackleton-rim", eastLonDeg: 11.3, latDeg: -89.5 },
  { id: "malapert-a", eastLonDeg: 17.5, latDeg: -87.8 },
  { id: "shoemaker", eastLonDeg: 11.7, latDeg: -87.6 },
  { id: "cavendish", eastLonDeg: 12.0, latDeg: -88.7 },
  { id: "apollo-11", eastLonDeg: 23.47, latDeg: 0.67 },
];

/**
 * Parse a URL query-string back into a ScenarioState.
 * Falls back to defaults for missing or invalid fields.
 */
export function scenarioFromQuery(params: URLSearchParams): ScenarioState {
  const version: string = params.get("v") ?? SCENARIO_VERSION;

  // Site
  let site: LunarSite | undefined = PRESET_SITES.find((s) => s.id === params.get("site"));
  if (!site) {
    const lon = parseFloat(params.get("lon") ?? "");
    const lat = parseFloat(params.get("lat") ?? "");
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      site = {
        id: (params.get("site") ?? "custom") as string,
        eastLonDeg: lon,
        latDeg: lat,
      };
    } else {
      site = DEFAULT_SITE;
    }
  }

  // Date
  const date = params.get("date");
  const dateUtc: string = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? (date ?? DEFAULT_DATE) : DEFAULT_DATE;

  // Constraints
  const constraintStr = params.get("constraints");
  const constraints: Constraint[] = constraintStr
    ? constraintStr.split(",").filter(Boolean).map((kind) => ({ id: kind, kind }))
    : DEFAULT_CONSTRAINTS;

  return { version, site: site ?? DEFAULT_SITE, dateUtc, constraints };
}

/**
 * Read the current ScenarioState from the browser URL hash or query string.
 */
export function readScenarioFromUrl(): ScenarioState {
  return scenarioFromQuery(new URLSearchParams(window.location.search));
}

/** Human-readable label for a site ID. */
export function siteLabel(id: string): string {
  return id
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
