/**
 * Terrain horizon mask retrieval and evaluation.
 */

import type { HorizonMask, LunarSite } from "../contracts";
import {
  validateHorizonMasksArtifact,
  type HorizonMasksArtifact,
} from "./artifact";

let configuredMasks: HorizonMasksArtifact | undefined;

export function configureHorizonMasksArtifact(artifact: HorizonMasksArtifact): void {
  configuredMasks = validateHorizonMasksArtifact(artifact);
}

export function resetConfiguredHorizonMasksArtifact(): void {
  configuredMasks = undefined;
}

/**
 * Retrieve horizon mask for a given site from the configured artifact.
 */
export function horizonMaskFor(site: LunarSite): HorizonMask {
  if (configuredMasks === undefined) {
    throw new Error("Horizon masks artifact is not configured; call configureHorizonMasksArtifact first");
  }

  // Exact ID match first
  let record = configuredMasks.sites.find((s) => s.id === site.id);

  // If no ID match, match by closest lat/lon within 0.05 degrees (~1.5 km)
  if (!record) {
    record = configuredMasks.sites.find(
      (s) =>
        Math.abs(s.latDeg - site.latDeg) < 0.05 &&
        Math.abs(s.eastLonDeg - site.eastLonDeg) < 0.05,
    );
  }

  if (!record) {
    throw new Error(`No terrain horizon mask found for site ${site.id} (${site.latDeg}, ${site.eastLonDeg})`);
  }

  return {
    siteId: record.id,
    eastLonDeg: record.eastLonDeg,
    latDeg: record.latDeg,
    elevationDeg: record.elevationDeg,
    status: record.status ?? "ok",
  };
}

/**
 * Evaluate horizon elevation in degrees at any azimuth (0 to 360) using linear interpolation.
 */
export function horizonElevationAt(mask: HorizonMask, azimuthDeg: number): number {
  const normalizedAz = ((azimuthDeg % 360) + 360) % 360;
  const numSamples = mask.elevationDeg.length;
  if (numSamples === 0) {
    return 0.0;
  }
  const step = 360.0 / numSamples;
  const indexFloat = normalizedAz / step;
  const i0 = Math.floor(indexFloat) % numSamples;
  const i1 = (i0 + 1) % numSamples;
  const fraction = indexFloat - Math.floor(indexFloat);
  return mask.elevationDeg[i0] * (1 - fraction) + mask.elevationDeg[i1] * fraction;
}
