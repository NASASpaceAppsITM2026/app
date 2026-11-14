#!/usr/bin/env node
/**
 * Fetch JPL Horizons golden validation fixtures into tests/fixtures/horizons/.
 *
 * Offline-first design (AGENTS.md §6, docs/VALIDATION.md): CI must not call
 * Horizons. This script is run manually on a developer machine; the generated
 * fixtures are committed and the tests run against the committed copies.
 *
 * Query contract for every fixture (pinned parameters, see docs/horizons.md,
 * docs/VALIDATION.md and AGENTS.md §5):
 *   format=json&OBJ_DATA=YES&MAKE_EPHEM=YES&EPHEM_TYPE=OBSERVER&COMMAND=<10|399>
 *   &CENTER='coord@301'&COORD_TYPE=GEODETIC&SITE_COORD='<eastLonDeg>,<latDeg>,<altKm>
 *   &START_TIME=<YYYY-MM-DD>&STOP_TIME=<YYYY-MM-DD>&STEP_SIZE=<step>
 *   &QUANTITIES=1,4&CSV_FORMAT=YES&TIME_DIGITS=FRACSEC
 *
 * - CENTER uses the non-Earth '@' surface-site form (`coord@301`), never the
 *   bare body id.
 * - QUANTITIES=1,4 requests astrometric RA/DEC (1) and azimuth/elevation (4) only;
 *   quantity 9 (magnitude) is never requested.
 * - CSV_FORMAT=YES and TIME_DIGITS=FRACSEC are required for validation-grade
 *   precision (the default time precision is minutes, insufficient).
 * - The JSON response must carry a `signature.version` string; format drift is
 *   treated as an error.
 *
 * Horizon tables emitted by the API are comma-separated text placed under the
 * `result` key of the JSON response, between the `$$SOE` and `$$EOE` markers.
 */

const HORIZONS_API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api";
const OUTPUT_DIR = new URL("../tests/fixtures/horizons/", import.meta.url);

const TARGETS = [
  { command: "10", name: "Sun" },
  { command: "399", name: "Earth" },
];

const CASES = [
  {
    id: "apollo11",
    name: "Apollo 11",
    eastLonDeg: 23.45,
    latDeg: 0.674,
    altKm: 0,
    startUtc: "2026-11-13T00:00:00Z",
    stopUtc: "2026-11-14T00:00:00Z",
  },
  {
    id: "south_pole",
    name: "Lunar south polar site",
    eastLonDeg: 0,
    latDeg: -89.5,
    altKm: 0,
    startUtc: "2026-11-13T00:00:00Z",
    stopUtc: "2026-11-14T00:00:00Z",
  },
  {
    id: "south_pole_summer",
    name: "Lunar south polar site",
    eastLonDeg: 180,
    latDeg: -89.5,
    altKm: 0,
    startUtc: "2026-06-21T00:00:00Z",
    stopUtc: "2026-06-22T00:00:00Z",
  },
];

const MONTHS = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

/** Build the full Horizons API query URL for one observer-site request. */
function buildHorizonsUrl(caseDef, target) {
  const params = new URLSearchParams();
  params.set("format", "json");
  params.set("OBJ_DATA", "YES");
  params.set("MAKE_EPHEM", "YES");
  params.set("EPHEM_TYPE", "OBSERVER");
  params.set("COMMAND", target.command);
  params.set("CENTER", "'coord@301'");
  params.set("COORD_TYPE", "GEODETIC");
  params.set("SITE_COORD", `${caseDef.eastLonDeg},${caseDef.latDeg},${caseDef.altKm}`);
  params.set("START_TIME", caseDef.startUtc.slice(0, 10));
  params.set("STOP_TIME", caseDef.stopUtc.slice(0, 10));
  params.set("STEP_SIZE", "1m");
  params.set("QUANTITIES", "1,4");
  params.set("CSV_FORMAT", "YES");
  params.set("TIME_DIGITS", "FRACSEC");
  const url = `${HORIZONS_API_URL}?${params.toString()}`;
  return url;
}

/** Extract comma-separated AZ/EL samples from the Horizons result text. */
function parseObserverSamples(resultText) {
  const soeIndex = resultText.indexOf("$$SOE");
  const eoeIndex = resultText.indexOf("$$EOE");
  if (soeIndex === -1 || eoeIndex === -1 || eoeIndex < soeIndex) {
    throw new Error("Horizons response missing $$SOE/$$EOE table markers");
  }
  const tableText = resultText.slice(soeIndex, eoeIndex);
  const lines = tableText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const samples = [];
  // First table line is the CSV header row (starts with the Date column).
  for (const line of lines.slice(1)) {
    const fields = line.split(",").map((field) => field.trim()).filter((f) => f !== "");
    if (fields.length < 2) continue;
    const azDeg = Number.parseFloat(fields[fields.length - 2]);
    const elDeg = Number.parseFloat(fields[fields.length - 1]);
    const timeTag = fields[0];
    const match = /^(\d{4})-?([A-Za-z]{3})-?(\d{1,2}) (\d{2}):(\d{2}):(\d{2})/.exec(timeTag);
    if (!match) continue;
    const [, year, monthName, day, hour, minute, second] = match;
    const month = MONTHS[monthName.charAt(0).toUpperCase() + monthName.slice(1).toLowerCase()];
    if (!month) continue;
    const timeUtc = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${hour}:${minute}:${second}.000Z`;
    if (!Number.isFinite(azDeg) || !Number.isFinite(elDeg)) continue;
    samples.push({ timeUtc, azDeg, elDeg });
  }
  if (samples.length === 0) {
    throw new Error("Horizons response contained no AZ/EL observer samples");
  }
  return samples;
}

async function fetchFixture(caseDef, target) {
  const url = buildHorizonsUrl(caseDef, target);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Horizons request failed for ${caseDef.id}/${target.name}: HTTP ${response.status}`);
  }
  const payload = await response.json();
  const signatureVersion = payload.signature?.version;
  if (typeof signatureVersion !== "string" || signatureVersion.length === 0) {
    throw new Error(`Horizons response for ${caseDef.id}/${target.name} missing signature.version`);
  }
  const resultText = payload.result;
  if (typeof resultText !== "string") {
    throw new Error(`Horizons response for ${caseDef.id}/${target.name} missing result text`);
  }
  const samples = parseObserverSamples(resultText);
  const year = caseDef.startUtc.slice(0, 4);
  const fixture = {
    fixtureVersion: 1,
    case: caseDef.id,
    target: { command: target.command, name: target.name },
    url,
    query: {
      format: "json",
      OBJ_DATA: "YES",
      MAKE_EPHEM: "YES",
      EPHEM_TYPE: "OBSERVER",
      COMMAND: target.command,
      CENTER: "'coord@301'",
      COORD_TYPE: "GEODETIC",
      SITE_COORD: `${caseDef.eastLonDeg},${caseDef.latDeg},${caseDef.altKm}`,
      START_TIME: caseDef.startUtc.slice(0, 10),
      STOP_TIME: caseDef.stopUtc.slice(0, 10),
      STEP_SIZE: "1m",
      QUANTITIES: "1,4",
      CSV_FORMAT: "YES",
      TIME_DIGITS: "FRACSEC",
    },
    signatureVersion,
    site: {
      id: caseDef.id,
      name: caseDef.name,
      eastLonDeg: caseDef.eastLonDeg,
      latDeg: caseDef.latDeg,
      altKm: caseDef.altKm,
    },
    dateRangeUtc: {
      start: caseDef.startUtc,
      stop: caseDef.stopUtc,
    },
    response: {
      result: resultText,
      signature: { source: payload.signature?.source ?? "NASA/JPL Horizons API", version: signatureVersion },
    },
    samples,
  };
  const filename = `${caseDef.id}_${target.name}_${year}.json`;
  const targetPath = new URL(filename, OUTPUT_DIR);
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  console.log(`ok ${filename} samples=${samples.length} signature=${signatureVersion}`);
  return { filename, sampleCount: samples.length };
}

async function main() {
  for (const target of TARGETS) {
    for (const caseDef of CASES) {
      const { filename, sampleCount } = await fetchFixture(caseDef, target);
      console.log(`  -> ${filename} (${sampleCount} samples)`);
    }
  }
}

const isDirectRun = process.argv[1]?.endsWith("fetch_horizons.mjs");
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
