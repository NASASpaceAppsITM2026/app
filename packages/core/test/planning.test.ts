import { describe, expect, it } from "vitest";
import syntheticEphemeris from "../../../tests/fixtures/synthetic/ephemeris_v1.json";
import syntheticMasks from "../../../tests/fixtures/synthetic/horizon_masks_v1.json";
import {
  type EphemerisArtifact,
  type HorizonMasksArtifact,
  type SlipWindowInput,
  configureEphemerisArtifact,
  configureHorizonMasksArtifact,
  resetConfiguredEphemerisArtifact,
  resetConfiguredHorizonMasksArtifact,
  slipWindowFinder,
} from "../src";

const ephemeris = syntheticEphemeris as unknown as EphemerisArtifact;
const masks = syntheticMasks as unknown as HorizonMasksArtifact;

const southPole895 = { id: "south_pole_895", eastLonDeg: 0.0, latDeg: -89.5 };
const apollo11 = { id: "apollo11", eastLonDeg: 23.45, latDeg: 0.674 };

// Synthetic ephemeris window: 2026-11-13T00:00:00Z to 2026-11-14T00:00:00Z (TDB).
// UTC↔TDB differs by ~32 s (leap seconds), so start ~10 min inside the window.
// Keep the range short enough to stay inside the window end.
const baseInput: SlipWindowInput = {
  site: southPole895,
  dateUtc: "2026-11-13T00:10:00Z",
  constraints: [],
  dateRangeDays: 0.25, // 6 hours, ends at 2026-11-13T06:10:00Z (well inside window)
};

function run(input: SlipWindowInput) {
  configureEphemerisArtifact(ephemeris);
  configureHorizonMasksArtifact(masks);
  try {
    return slipWindowFinder(input);
  } finally {
    resetConfiguredEphemerisArtifact();
    resetConfiguredHorizonMasksArtifact();
  }
}

describe("planning slipWindowFinder", () => {
  it("returns one candidate per sampled epoch across the date range", () => {
    const result = run(baseInput);
    const stepSec = 30 * 60;
    const expectedCount = (6 * 60 * 60) / stepSec + 1; // 6 hours at 30-min steps
    expect(result.candidates).toHaveLength(expectedCount);
    for (const candidate of result.candidates) {
      expect(["meets", "misses", "unknown"]).toContain(candidate.verdict);
      expect(typeof candidate.reason).toBe("string");
      expect(candidate.reason.length).toBeGreaterThan(0);
    }
  });

  it("boundary: first candidate at range start, last at range end", () => {
    const result = run(baseInput);
    expect(result.candidates[0].dateUtc).toBe("2026-11-13T00:10:00.000Z");
    expect(result.candidates[result.candidates.length - 1].dateUtc).toBe(
      "2026-11-13T06:10:00.000Z",
    );
  });

  it("meets verdict with no constraints and ok horizon mask coverage", () => {
    const result = run(baseInput);
    for (const candidate of result.candidates) {
      expect(candidate.verdict).toBe("meets");
      expect(candidate.reason).toContain("No constraints evaluated");
    }
  });

  it("tie: consecutive candidates all share the same verdict", () => {
    const result = run(baseInput);
    const verdicts = result.candidates.map((c) => c.verdict);
    expect(new Set(verdicts).size).toBe(1);
    expect(verdicts[0]).toBe("meets");
  });

  it("unknown when the date range is outside the ephemeris window", () => {
    const result = run({
      ...baseInput,
      dateUtc: "2026-11-14T01:00:00Z",
    });
    for (const candidate of result.candidates) {
      expect(candidate.verdict).toBe("unknown");
      expect(candidate.reason).toContain("Ephemeris not available");
    }
  });

  it("unknown when horizon mask coverage is missing (missing data is never meets)", () => {
    const result = run({
      ...baseInput,
      site: apollo11,
    });
    for (const candidate of result.candidates) {
      expect(candidate.verdict).toBe("unknown");
      expect(candidate.reason).toContain("coverage");
    }
  });
});
