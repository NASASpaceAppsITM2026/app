/**
 * Core ephemeris entry point: `skyAt`.
 *
 * Evaluates the `ephemeris_v1` Chebyshev fits (Moon→Sun and Moon→Earth apparent
 * directions) for a surface site at an epoch and returns the local azimuth/elevation
 * in the East-North-Up frame.
 *
 * Conventions (AGENTS.md §5, docs/data-contracts.md §2):
 * - Moon body-fixed frame: `MOON_ME` (mean-Earth / mean-rotation axis); fits are
 *   expressed in that frame and are expected to carry the `apparent` (aberrated)
 *   direction correction.
 * - Time: TDB seconds past J2000 (`epochTdbSec`); fails loudly outside the supported
 *   ephemeris window.
 * - Local frame: East-North-Up at the site; azimuth clockwise from North, elevation
 *   relative to the local horizontal plane. Radians only inside the tight math helpers,
 *   converted at boundaries.
 */

import {
  BODY_PAIR_MOON_TO_EARTH,
  BODY_PAIR_MOON_TO_SUN,
  evaluateChebyshev,
  selectSegment,
  validateEphemerisArtifact,
  type EphemerisArtifact,
} from "./artifact";
import type { LunarSite, SkyState } from "../contracts";

/**
 * Moon sphere reference radius in kilometers (LOLA / NAIF convention). Source: NAIF
 * lunar PCK / PDS LOLA products; see `docs/DATA.md`.
 */
export const MOON_SPHERE_RADIUS_KM = 1737.4;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

interface LocalFrame {
  readonly up: [number, number, number];
  readonly east: [number, number, number];
  readonly north: [number, number, number];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** East-North-Up local frame at a surface site (site lat/lon are geodetic on the sphere). */
function localFrame(site: LunarSite): LocalFrame {
  const phi = site.latDeg * DEG_TO_RAD;
  const lambda = site.eastLonDeg * DEG_TO_RAD;
  const up: [number, number, number] = [
    Math.cos(phi) * Math.cos(lambda),
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
  ];
  const east: [number, number, number] = [-Math.sin(lambda), Math.cos(lambda), 0];
  const north = cross(up, east);
  return { up, east, north };
}

function toUnitVector(direction: readonly number[]): [number, number, number] {
  const length = Math.sqrt(dot(direction, direction));
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error(`Ephemeris fit returned a degenerate Moon->body direction (length ${String(length)})`);
  }
  return [direction[0] / length, direction[1] / length, direction[2] / length];
}

function azimuthDeg(direction: readonly number[], frame: LocalFrame): number {
  const azimuthRad = Math.atan2(dot(direction, frame.east), dot(direction, frame.north));
  const azimuthDeg = azimuthRad * RAD_TO_DEG;
  const normalized = azimuthDeg < 0 ? azimuthDeg + 360 : azimuthDeg;
  return normalized;
}

function elevationDeg(direction: readonly number[], frame: LocalFrame): number {
  const sinElevation = Math.min(1, Math.max(-1, dot(direction, frame.up)));
  return Math.asin(sinElevation) * RAD_TO_DEG;
}

/** Compute apparent Sun/Earth azimuth/elevation for a site at an epoch from the fits. */
export function computeSkyState(
  artifact: EphemerisArtifact,
  site: LunarSite,
  epochTdbSec: number,
): SkyState {
  const validated = validateEphemerisArtifact(artifact);
  const { supportedStartEpochTdbSec, supportedEndEpochTdbSec } = validated.header;
  if (epochTdbSec < supportedStartEpochTdbSec || epochTdbSec > supportedEndEpochTdbSec) {
    throw new Error(
      `EpochTdbSec ${String(epochTdbSec)} is outside the supported ephemeris window ` +
        `[${String(supportedStartEpochTdbSec)}, ${String(supportedEndEpochTdbSec)}]`,
    );
  }
  const sunSegment = selectSegment(validated, BODY_PAIR_MOON_TO_SUN, epochTdbSec);
  const earthSegment = selectSegment(validated, BODY_PAIR_MOON_TO_EARTH, epochTdbSec);
  const sunFit = evaluateChebyshev(sunSegment, epochTdbSec);
  const earthFit = evaluateChebyshev(earthSegment, epochTdbSec);
  const sunDirection = toUnitVector(sunFit.direction);
  const earthDirection = toUnitVector(earthFit.direction);
  const frame = localFrame(site);
  return {
    epochTdbSec,
    sunAzimuthDeg: azimuthDeg(sunDirection, frame),
    sunElevationDeg: elevationDeg(sunDirection, frame),
    earthAzimuthDeg: azimuthDeg(earthDirection, frame),
    earthElevationDeg: elevationDeg(earthDirection, frame),
  };
}

/** Artifact currently used by {@link skyAt}. Set once via {@link configureEphemerisArtifact}. */
let configuredArtifact: EphemerisArtifact | undefined;

/** Configure the ephemeris artifact evaluated by {@link skyAt}. */
export function configureEphemerisArtifact(artifact: EphemerisArtifact): void {
  configuredArtifact = artifact;
}

/** Reset the configured ephemeris artifact (primarily for test isolation). */
export function resetConfiguredEphemerisArtifact(): void {
  configuredArtifact = undefined;
}

/**
 * Compute apparent Sun/Earth azimuth/elevation for a site at an epoch, evaluating the
 * configured `ephemeris_v1` Chebyshev fits for any site and time in the supported
 * window. Fails loudly outside the supported window or when no fit segment covers the
 * epoch.
 */
export function skyAt(site: LunarSite, epochTdbSec: number): SkyState {
  const artifact = configuredArtifact;
  if (artifact === undefined) {
    throw new Error("Ephemeris artifact is not configured; call configureEphemerisArtifact first");
  }
  return computeSkyState(artifact, site, epochTdbSec);
}
