import { describe, expect, it } from "vitest";
import syntheticMasks from "../../../tests/fixtures/synthetic/horizon_masks_v1.json";
import {
  type HorizonMasksArtifact,
  configureHorizonMasksArtifact,
  horizonElevationAt,
  horizonMaskFor,
  resetConfiguredHorizonMasksArtifact,
} from "../src/terrain";

const artifact = syntheticMasks as unknown as HorizonMasksArtifact;

describe("core terrain horizon mask reader and interpolation", () => {
  it("fails loudly when horizon masks artifact is not configured", () => {
    resetConfiguredHorizonMasksArtifact();
    expect(() => horizonMaskFor({ id: "apollo11", eastLonDeg: 23.45, latDeg: 0.674 })).toThrow(
      /Horizon masks artifact is not configured/,
    );
  });

  it("retrieves horizon mask for Apollo 11 with missing_coverage status", () => {
    configureHorizonMasksArtifact(artifact);
    const mask = horizonMaskFor({ id: "apollo11", eastLonDeg: 23.45, latDeg: 0.674 });
    expect(mask.siteId).toBe("apollo11");
    expect(mask.status).toBe("missing_coverage");
    expect(mask.elevationDeg.length).toBe(360);
  });

  it("retrieves horizon mask for south polar sites", () => {
    configureHorizonMasksArtifact(artifact);
    const mask = horizonMaskFor({ id: "south_pole_895", eastLonDeg: 0.0, latDeg: -89.5 });
    expect(mask.siteId).toBe("south_pole_895");
    expect(mask.status).toBe("ok");
    expect(mask.elevationDeg.length).toBe(360);
    // At south pole, elevation should be positive on several azimuths
    expect(Math.max(...mask.elevationDeg)).toBeGreaterThan(5.0);
  });

  it("interpolates horizon elevation continuously across azimuths", () => {
    configureHorizonMasksArtifact(artifact);
    const mask = horizonMaskFor({ id: "south_pole_895", eastLonDeg: 0.0, latDeg: -89.5 });
    const elev0 = horizonElevationAt(mask, 0.0);
    const elev1 = horizonElevationAt(mask, 1.0);
    const elevHalf = horizonElevationAt(mask, 0.5);
    expect(elevHalf).toBeCloseTo((elev0 + elev1) / 2.0, 5);

    // Azimuth wrap 360 -> 0
    expect(horizonElevationAt(mask, 360.0)).toBeCloseTo(horizonElevationAt(mask, 0.0), 5);
  });
});
