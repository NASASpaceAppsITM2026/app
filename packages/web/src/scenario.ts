/**
 * ScenarioState — URL-serializable representation of the current navigation scenario.
 *
 * A scenario captures the site, date, hour, view mode, and constraints the user is exploring.
 * It serializes to a compact query-string fragment so the URL can be shared
 * without credentials, private notes, or large datasets.
 *
 * Conventions:
 * - Versioned so future schema changes remain backward-compatible.
 * - No secrets, no large arrays. Only scalar values.
 * - Units carried in names: `latDeg`, `lonDeg`, `dateUtc`, `hourUtc`.
 */

import type { Constraint, LunarSite } from "core";

/** Version of the ScenarioState serialization format. */
const SCENARIO_VERSION = "1";

/** Known preset sites validated against LOLA DEM horizon masks and SPICE ephemeris. */
export const PRESET_SITES: LunarSite[] = [
  { id: "shackleton_connecting_ridge", eastLonDeg: 120.0, latDeg: -89.9 },
  { id: "malapert_mountain", eastLonDeg: 2.7, latDeg: -86.0 },
  { id: "de_gerlache_rim", eastLonDeg: -88.0, latDeg: -88.5 },
  { id: "haworth_crater_rim", eastLonDeg: -5.0, latDeg: -87.4 },
  { id: "south_pole_895", eastLonDeg: 0.0, latDeg: -89.5 },
  { id: "south_pole_summer", eastLonDeg: 180.0, latDeg: -89.5 },
  { id: "apollo11", eastLonDeg: 23.45, latDeg: 0.674 },
  // Apollo Program landing sites (additional lunar landing sites).
  { id: "apollo12", eastLonDeg: 136.21, latDeg: 31.95 },
  { id: "apollo14", eastLonDeg: 44.22, latDeg: 40.92 },
  { id: "apollo15", eastLonDeg: 3.72, latDeg: 26.44 },
  { id: "apollo17", eastLonDeg: 87.71, latDeg: 14.12 },
  { id: "luna16", eastLonDeg: 93.89, latDeg: 31.17 },
  // Additional Apollo and Luna landing sites (data‑only presets)
  { id: "apollo16", eastLonDeg: 15.501, latDeg: -8.998 }, // Descartes Highlands
  { id: "luna17", eastLonDeg: 30.8, latDeg: 26.9 }, // Mare Imbrium (Luna 17 rover)
  { id: "luna20", eastLonDeg: 62.2, latDeg: 0.7 } // Luna 20, Mare Serenitatis
];

/** Default site: Shackleton connecting ridge (Artemis candidate). */
export const DEFAULT_SITE: LunarSite = PRESET_SITES[0];

/** Default date: mid-2026 within the DE440 SPICE Chebyshev fit window. */
export const DEFAULT_DATE = "2026-06-15";

/** Default hour: 12:00 UTC. */
export const DEFAULT_HOUR_UTC = 12;

/** Default constraints: sun above terrain mask + Earth above terrain mask. */
export const DEFAULT_CONSTRAINTS: Constraint[] = [
  { id: "sun-mask", kind: "sunAboveMask" },
  { id: "earth-mask", kind: "earthAboveMask" },
];

/** Full scenario state held in memory. */
export interface ScenarioState {
  readonly version: string;
  readonly site: LunarSite;
  readonly dateUtc: string; // ISO-8601 date YYYY-MM-DD
  readonly hourUtc: number; // 0 to 23
  readonly viewMode: "overview" | "site-level";
  readonly constraints: readonly Constraint[];
}

/** Default scenario. */
export function defaultScenario(): ScenarioState {
  return {
    version: SCENARIO_VERSION,
    site: DEFAULT_SITE,
    dateUtc: DEFAULT_DATE,
    hourUtc: DEFAULT_HOUR_UTC,
    viewMode: "overview",
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
    hour: String(state.hourUtc ?? DEFAULT_HOUR_UTC),
    view: state.viewMode,
    constraints: state.constraints.map((c) => c.kind).join(","),
  };
}

/**
 * Build a full shareable URL from the current origin and a ScenarioState.
 */
export function scenarioToUrl(state: ScenarioState): string {
  const params = new URLSearchParams(scenarioToQuery(state));
  const origin = typeof window !== "undefined" ? window.location.origin : "https://lunar-navigator.nasa";
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  return `${origin}${path}?${params.toString()}`;
}

/**
 * Legacy ID aliases mapping old preset names to current pipeline IDs.
 */
const ID_ALIASES: Record<string, string> = {
  "shackleton-rim": "shackleton_connecting_ridge",
  "malapert-a": "malapert_mountain",
  "apollo-11": "apollo11",
  shoemaker: "haworth_crater_rim",
  cavendish: "south_pole_895",
};

/**
 * Parse a URL query-string back into a ScenarioState.
 * Falls back to defaults for missing or invalid fields.
 */
export function scenarioFromQuery(params: URLSearchParams): ScenarioState {
  const version: string = params.get("v") ?? SCENARIO_VERSION;

  // Site
  const rawSiteId = params.get("site");
  const normalizedId = rawSiteId && ID_ALIASES[rawSiteId] ? ID_ALIASES[rawSiteId] : rawSiteId;
  let site: LunarSite | undefined = PRESET_SITES.find((s) => s.id === normalizedId);

  if (!site) {
    const lon = parseFloat(params.get("lon") ?? "");
    const lat = parseFloat(params.get("lat") ?? "");
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      site = {
        id: (rawSiteId ?? "custom") as string,
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

  // Hour
  const rawHour = parseInt(params.get("hour") ?? "", 10);
  const hourUtc = Number.isFinite(rawHour) && rawHour >= 0 && rawHour <= 23 ? rawHour : DEFAULT_HOUR_UTC;

  // View mode
  const rawView = params.get("view");
  const viewMode: "overview" | "site-level" = rawView === "site-level" ? "site-level" : "overview";

  // Constraints
  const constraintStr = params.get("constraints");
  const constraints: Constraint[] = constraintStr
    ? constraintStr.split(",").filter(Boolean).map((kind) => ({ id: kind, kind }))
    : DEFAULT_CONSTRAINTS;

  return { version, site: site ?? DEFAULT_SITE, dateUtc, hourUtc, viewMode, constraints };
}

/**
 * Read the current ScenarioState from the browser URL query string.
 */
export function readScenarioFromUrl(): ScenarioState {
  if (typeof window === "undefined") return defaultScenario();
  return scenarioFromQuery(new URLSearchParams(window.location.search));
}

/** Human-readable label for a site ID. */
export function siteLabel(id: string): string {
  const map: Record<string, string> = {
    shackleton_connecting_ridge: "Shackleton Connecting Ridge",
    malapert_mountain: "Malapert Mountain Peak",
    de_gerlache_rim: "De Gerlache Crater Rim",
    haworth_crater_rim: "Haworth Crater Rim",
    south_pole_895: "South Pole -89.5° (Prime Meridian)",
    south_pole_summer: "South Pole -89.5° (180°E)",
    apollo11: "Apollo 11 Landing Site",
    apollo12: "Apollo 12 Landing Site",
    apollo14: "Apollo 14 Landing Site",
    apollo15: "Apollo 15 Landing Site",
    apollo16: "Apollo 16 Landing Site",
    apollo17: "Apollo 17 Landing Site",
    luna16: "Luna 16 Landing Site",
    luna17: "Luna 17 Landing Site",
    luna20: "Luna 20 Landing Site",
  };
  if (map[id]) return map[id];
  return id
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
