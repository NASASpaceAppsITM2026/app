import { describe, expect, it } from "vitest";
import artifact from "../../../../tests/fixtures/synthetic/ephemeris_v1.json";
import { configureEphemerisArtifact, resetConfiguredEphemerisArtifact, skyAt } from "./ephemeris";
import { validateEphemerisArtifact, type EphemerisArtifact } from "./artifact";

// Supported ephemeris window of the synthetic `ephemeris_v1` fit, in TDB seconds
// past J2000: 2026-11-13T00:00:00Z (start) to 2026-11-14T00:00:00Z (end).
const EPOCH_START_TDB_SEC = 847800032.184;
const EPOCH_END_TDB_SEC = 847886432.184;
const EPOCH_MID_TDB_SEC = 847843200.184;

interface Frame {
  readonly up: [number, number, number];
  readonly east: [number, number, number];
  readonly north: [number, number, number];
}

/** Independent East-North-Up frame construction for expectation checks. */
function localFrame(eastLonDeg: number, latDeg: number): Frame {
  const phi = (latDeg * Math.PI) / 180;
  const lambda = (eastLonDeg * Math.PI) / 180;
  const up: [number, number, number] = [
    Math.cos(phi) * Math.cos(lambda),
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
  ];
  const east: [number, number, number] = [-Math.sin(lambda), Math.cos(lambda), 0];
  // cross(up, east) computed explicitly for clarity
  const cross: [number, number, number] = [
    up[1] * east[2] - up[2] * east[1],
    up[2] * east[0] - up[0] * east[2],
    up[0] * east[1] - up[1] * east[0],
  ];
  return { up, east, north: cross };
}

function expectedAzimuthDeg(frame: Frame, direction: readonly number[]): number {
  const azimuthRad = Math.atan2(
    direction[0] * frame.east[0] + direction[1] * frame.east[1] + direction[2] * frame.east[2],
    direction[0] * frame.north[0] + direction[1] * frame.north[1] + direction[2] * frame.north[2],
  );
  const azimuthDeg = (azimuthRad * 180) / Math.PI;
  return azimuthDeg < 0 ? azimuthDeg + 360 : azimuthDeg;
}

function expectedElevationDeg(frame: Frame, direction: readonly number[]): number {
  const sinElevation = direction[0] * frame.up[0] + direction[1] * frame.up[1] + direction[2] * frame.up[2];
  return (Math.asin(Math.min(1, Math.max(-1, sinElevation))) * 180) / Math.PI;
}

describe("ephemeris skyAt over synthetic fits", () => {
  it("evaluates the synthetic ephemeris fits for a site and time in the supported window", () => {
    configureEphemerisArtifact(artifact);
    const result = skyAt({ id: "synthetic-south-pole", eastLonDeg: 0, latDeg: -89.5 }, EPOCH_MID_TDB_SEC);

    expect(result.epochTdbSec).toBe(EPOCH_MID_TDB_SEC);
    const frame = localFrame(0, -89.5);
    expect(result.sunAzimuthDeg).toBeCloseTo(expectedAzimuthDeg(frame, [0, 0, 1]), 6);
    expect(result.sunElevationDeg).toBeCloseTo(expectedElevationDeg(frame, [0, 0, 1]), 6);
    expect(result.earthAzimuthDeg).toBeCloseTo(expectedAzimuthDeg(frame, [1, 0, 0]), 6);
    expect(result.earthElevationDeg).toBeCloseTo(expectedElevationDeg(frame, [1, 0, 0]), 6);
  });

  it("accepts epochs at both ends of the supported window", () => {
    configureEphemerisArtifact(artifact);
    const atStart = skyAt({ id: "synthetic-south-pole", eastLonDeg: 0, latDeg: -89.5 }, EPOCH_START_TDB_SEC);
    const atEnd = skyAt({ id: "synthetic-south-pole", eastLonDeg: 0, latDeg: -89.5 }, EPOCH_END_TDB_SEC);
    expect(atStart.epochTdbSec).toBe(EPOCH_START_TDB_SEC);
    expect(atEnd.epochTdbSec).toBe(EPOCH_END_TDB_SEC);
  });

  it("fails loudly for epochs outside the supported ephemeris window", () => {
    configureEphemerisArtifact(artifact);
    expect(() => skyAt({ id: "synthetic-south-pole", eastLonDeg: 0, latDeg: -89.5 }, EPOCH_START_TDB_SEC - 1)).toThrow(
      /outside the supported ephemeris window/,
    );
    expect(() => skyAt({ id: "synthetic-south-pole", eastLonDeg: 0, latDeg: -89.5 }, EPOCH_END_TDB_SEC + 1)).toThrow(
      /outside the supported ephemeris window/,
    );
  });

  it("fails loudly when no fit segment covers the epoch", () => {
    const validated = validateEphemerisArtifact(artifact);
    const truncated: EphemerisArtifact = {
      ...validated,
      segments: validated.segments.map((segment, index) =>
        index === 0 ? { ...segment, endEpochTdbSec: EPOCH_START_TDB_SEC + 3600 } : segment,
      ),
    };
    configureEphemerisArtifact(truncated);
    expect(() => skyAt({ id: "synthetic-south-pole", eastLonDeg: 0, latDeg: -89.5 }, EPOCH_MID_TDB_SEC)).toThrow(
      /No ephemeris segment for body pair MOON_TO_SUN covers/,
    );
  });

  it("fails loudly for an unsupported ephemeris artifact schema version", () => {
    expect(() => validateEphemerisArtifact({ ...artifact, schemaVersion: 2 })).toThrow(
      /Unsupported ephemeris artifact schema version/,
    );
  });

  it("fails loudly when the ephemeris artifact is not configured", () => {
    resetConfiguredEphemerisArtifact();
    expect(() => skyAt({ id: "synthetic-south-pole", eastLonDeg: 0, latDeg: -89.5 }, EPOCH_MID_TDB_SEC)).toThrow(
      /Ephemeris artifact is not configured/,
    );
  });

  it("returns different sky positions for different sites", () => {
    configureEphemerisArtifact(artifact);
    const southPole = skyAt({ id: "synthetic-south-pole", eastLonDeg: 0, latDeg: -89.5 }, EPOCH_MID_TDB_SEC);
    const apollo11Like = skyAt({ id: "apollo11-like", eastLonDeg: 23.45, latDeg: 0.674 }, EPOCH_MID_TDB_SEC);
    expect(apollo11Like.sunElevationDeg).not.toBeCloseTo(southPole.sunElevationDeg, 6);
    expect(apollo11Like.earthAzimuthDeg).not.toBeCloseTo(southPole.earthAzimuthDeg, 6);
  });
});
