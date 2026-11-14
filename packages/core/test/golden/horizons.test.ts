import { describe, expect, it } from "vitest";
import apollo11Sun from "../../../../tests/fixtures/horizons/apollo11_Sun_2026.json";
import apollo11Earth from "../../../../tests/fixtures/horizons/apollo11_Earth_2026.json";
import southPoleSun from "../../../../tests/fixtures/horizons/south_pole_Sun_2026.json";
import southPoleEarth from "../../../../tests/fixtures/horizons/south_pole_Earth_2026.json";
import southPoleSummerSun from "../../../../tests/fixtures/horizons/south_pole_summer_Sun_2026.json";
import southPoleSummerEarth from "../../../../tests/fixtures/horizons/south_pole_summer_Earth_2026.json";
import ephemeris2026 from "../../../../tests/fixtures/ephemeris_2026.json";
import { configureEphemerisArtifact, skyAt, type EphemerisArtifact } from "../../src/ephemeris";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Wrap-aware azimuth difference in degrees in (-180, 180]. */
export function wrapAzimuthDiffDeg(az1Deg: number, az2Deg: number): number {
  let diff = (az1Deg - az2Deg) % 360;
  if (diff > 180) diff -= 360;
  if (diff <= -180) diff += 360;
  return diff;
}

/** Unit vector in East-North-Up given azimuth (clockwise from North) and elevation. */
export function azElToUnitVector(azDeg: number, elDeg: number): [number, number, number] {
  const azRad = azDeg * DEG_TO_RAD;
  const elRad = elDeg * DEG_TO_RAD;
  const cosEl = Math.cos(elRad);
  return [cosEl * Math.sin(azRad), cosEl * Math.cos(azRad), Math.sin(elRad)];
}

/** Angular separation between two directions in degrees. */
export function angularSeparationDeg(
  az1Deg: number,
  el1Deg: number,
  az2Deg: number,
  el2Deg: number,
): number {
  const v1 = azElToUnitVector(az1Deg, el1Deg);
  const v2 = azElToUnitVector(az2Deg, el2Deg);
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const clampedDot = Math.min(1, Math.max(-1, dot));
  return Math.acos(clampedDot) * RAD_TO_DEG;
}

describe("JPL Horizons golden validation fixtures and metrics", () => {
  const fixtures = [
    { name: "Apollo 11 Sun 2026", fixture: apollo11Sun },
    { name: "Apollo 11 Earth 2026", fixture: apollo11Earth },
    { name: "South Pole Sun 2026", fixture: southPoleSun },
    { name: "South Pole Earth 2026", fixture: southPoleEarth },
    { name: "South Pole Summer Sun 2026", fixture: southPoleSummerSun },
    { name: "South Pole Summer Earth 2026", fixture: southPoleSummerEarth },
  ];

  for (const { name, fixture } of fixtures) {
    it(`fixture ${name} complies with the Horizons validation contract`, () => {
      expect(fixture.fixtureVersion).toBe(1);
      expect(fixture.signatureVersion).toBe("1.2");
      expect(fixture.query.CENTER).toBe("'coord@301'");
      expect(fixture.query.COORD_TYPE).toBe("GEODETIC");
      expect(fixture.query.QUANTITIES).toBe("1,4");
      expect(fixture.query.CSV_FORMAT).toBe("YES");
      expect(fixture.query.TIME_DIGITS).toBe("FRACSEC");
      expect(fixture.samples.length).toBeGreaterThan(1400);

      // Verify sample properties
      for (let i = 0; i < Math.min(50, fixture.samples.length); i++) {
        const s = fixture.samples[i];
        expect(Number.isFinite(s.azDeg)).toBe(true);
        expect(Number.isFinite(s.elDeg)).toBe(true);
        expect(s.azDeg).toBeGreaterThanOrEqual(0);
        expect(s.azDeg).toBeLessThanOrEqual(360);
        expect(s.elDeg).toBeGreaterThanOrEqual(-90);
        expect(s.elDeg).toBeLessThanOrEqual(90);
      }
    });
  }

  it("calculates wrap-aware azimuth differences correctly", () => {
    expect(wrapAzimuthDiffDeg(1, 359)).toBeCloseTo(2, 6);
    expect(wrapAzimuthDiffDeg(359, 1)).toBeCloseTo(-2, 6);
    expect(wrapAzimuthDiffDeg(180, 180)).toBeCloseTo(0, 6);
    expect(wrapAzimuthDiffDeg(0, 180)).toBeCloseTo(180, 6);
  });

  it("calculates angular separation on the sphere correctly", () => {
    expect(angularSeparationDeg(0, 0, 0, 0)).toBeCloseTo(0, 6);
    expect(angularSeparationDeg(0, 0, 90, 0)).toBeCloseTo(90, 6);
    expect(angularSeparationDeg(0, 0, 0, 45)).toBeCloseTo(45, 6);
    expect(angularSeparationDeg(359.99, 10, 0.01, 10)).toBeLessThan(0.05);
  });

  describe("Golden test vs JPL Horizons (< 0.01 deg tolerance gate)", () => {
    configureEphemerisArtifact(ephemeris2026 as unknown as EphemerisArtifact);

    for (const { name, fixture } of fixtures) {
      it(`validates ${name} within 0.01 deg tolerance against JPL Horizons`, () => {
        const isSun = fixture.target.name === "Sun";
        const site = {
          id: fixture.site.id,
          eastLonDeg: fixture.site.eastLonDeg,
          latDeg: fixture.site.latDeg,
        };

        let maxSepDeg = 0;
        let maxAzDiffDeg = 0;
        let maxElDiffDeg = 0;

        // Check every 10th sample across the 24-hour fixture (145 checks per fixture)
        for (let i = 0; i < fixture.samples.length; i += 10) {
          const s = fixture.samples[i];
          const unixSec = Date.parse(s.timeUtc) / 1000;
          // SPICE ET/TDB = (unixSec - 946728000) + 69.1827s in 2026
          const epochTdbSec = unixSec - 946728000 + 69.1827;
          const state = skyAt(site, epochTdbSec);

          const compAz = isSun ? state.sunAzimuthDeg : state.earthAzimuthDeg;
          const compEl = isSun ? state.sunElevationDeg : state.earthElevationDeg;

          const azDiff = Math.abs(wrapAzimuthDiffDeg(compAz, s.azDeg));
          const elDiff = Math.abs(compEl - s.elDeg);
          const sep = angularSeparationDeg(compAz, compEl, s.azDeg, s.elDeg);

          if (sep > maxSepDeg) maxSepDeg = sep;
          if (azDiff > maxAzDiffDeg) maxAzDiffDeg = azDiff;
          if (elDiff > maxElDiffDeg) maxElDiffDeg = elDiff;

          // Non-polar or when elevation is not near +/- 90, azimuth must match < 0.01 deg
          if (Math.abs(s.elDeg) < 89.0) {
            expect(azDiff).toBeLessThan(0.01);
          }
          expect(elDiff).toBeLessThan(0.01);
          expect(sep).toBeLessThan(0.01);
        }
      });
    }
  });
});
