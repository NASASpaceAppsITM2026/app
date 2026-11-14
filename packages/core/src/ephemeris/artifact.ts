/**
 * Ephemeris artifact (`ephemeris_v1`) types, validation and Chebyshev fit evaluation.
 *
 * Mirrors the `ephemeris_v1` artifact contract in `docs/data-contracts.md` §4 and the
 * ephemeris conventions in `AGENTS.md` §5 (Moon body-fixed frame `MOON_ME`, time scale
 * `TDB`, apparent aberration correction, units carried in field names).
 *
 * The runtime ephemeris is a set of Chebyshev polynomial fits of the Moon→body
 * direction (and distance) over the supported epoch window. The fit error budget is
 * recorded in the header (`fitErrorDirectionDeg`).
 */

/** Artifact schema version supported by this consumer. */
export const SUPPORTED_EPHEMERIS_SCHEMA_VERSION = 1;

/** Body pairs covered by the `ephemeris_v1` segments. */
export const BODY_PAIR_MOON_TO_SUN = "MOON_TO_SUN";
export const BODY_PAIR_MOON_TO_EARTH = "MOON_TO_EARTH";

/** Units of the ephemeris artifact header, per `docs/data-contracts.md` §2.1. */
export interface EphemerisUnits {
  readonly time: string; // "TDB seconds"
  readonly direction: string; // "degrees"
  readonly distance: string; // "kilometers"
}

/** Header of the `ephemeris_v1` artifact. */
export interface EphemerisHeader {
  readonly schemaVersion: number;
  readonly kernels: readonly { readonly name: string; readonly sha256: string }[];
  readonly frame: string; // Moon body-fixed frame, e.g. "MOON_ME"
  readonly aberrationCorrection: string; // e.g. "apparent"
  readonly timeScale: string; // e.g. "TDB"
  readonly units: EphemerisUnits;
  readonly supportedStartEpochTdbSec: number; // TDB seconds past J2000
  readonly supportedEndEpochTdbSec: number; // TDB seconds past J2000
  readonly fitErrorDirectionDeg: number; // degrees
  readonly fitErrorMeasuredDirectionDeg: number; // degrees
}

/** Chebyshev fit of one body pair over one segment. */
export interface EphemerisChebyshev {
  readonly order: number;
  /**
   * Chebyshev series coefficients, series-major: entry `k` is the coefficient for the
   * basis function `T_k(t)` and holds the Moon→body direction vector components
   * (x, y, z of the `MOON_ME` frame) for that term. Length must be `order + 1`.
   */
  readonly direction: readonly (readonly number[])[];
  /** Chebyshev series coefficients (scalar): entry `k` is the distance coefficient for `T_k(t)`. Length must be `order + 1`. */
  readonly distanceKm: readonly number[];
}

/** One contiguous fit segment. */
export interface EphemerisSegment {
  readonly bodyPair: string;
  readonly startEpochTdbSec: number; // TDB seconds past J2000
  readonly endEpochTdbSec: number; // TDB seconds past J2000
  readonly chebyshev: EphemerisChebyshev;
}

/** The versioned `ephemeris_v1` artifact. */
export interface EphemerisArtifact {
  readonly schemaVersion: number;
  readonly header: EphemerisHeader;
  readonly segments: readonly EphemerisSegment[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidBodyPair(value: unknown): value is string {
  return value === BODY_PAIR_MOON_TO_SUN || value === BODY_PAIR_MOON_TO_EARTH;
}

/**
 * Validate an `ephemeris_v1` artifact against the data contract and fail loudly on
 * anything unsupported or malformed.
 */
export function validateEphemerisArtifact(input: unknown): EphemerisArtifact {
  if (!isRecord(input)) {
    throw new Error("Invalid ephemeris_v1 artifact: expected an object");
  }
  if (input.schemaVersion !== SUPPORTED_EPHEMERIS_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported ephemeris artifact schema version: expected ${SUPPORTED_EPHEMERIS_SCHEMA_VERSION}, got ${String(input.schemaVersion)}`,
    );
  }
  if (!isRecord(input.header)) {
    throw new Error("Invalid ephemeris_v1 artifact: missing or invalid header");
  }
  const header: Record<string, unknown> = input.header;
  if (header.frame !== "MOON_ME") {
    throw new Error(`Unsupported ephemeris frame: expected "MOON_ME", got ${String(header.frame)}`);
  }
  if (header.timeScale !== "TDB") {
    throw new Error(`Unsupported ephemeris time scale: expected "TDB", got ${String(header.timeScale)}`);
  }
  if (header.aberrationCorrection !== "apparent") {
    throw new Error(
      `Unsupported ephemeris aberration correction: expected "apparent", got ${String(header.aberrationCorrection)}`,
    );
  }
  const units = header.units;
  if (
    !isRecord(units) ||
    !isNonEmptyString(units.time) ||
    !isNonEmptyString(units.direction) ||
    !isNonEmptyString(units.distance)
  ) {
    throw new Error("Invalid ephemeris_v1 artifact: header.units is missing or malformed");
  }
  if (!isFiniteNumber(header.supportedStartEpochTdbSec) || !isFiniteNumber(header.supportedEndEpochTdbSec)) {
    throw new Error("Invalid ephemeris_v1 artifact: header supported epoch window is not numeric");
  }
  if (header.supportedStartEpochTdbSec > header.supportedEndEpochTdbSec) {
    throw new Error(
      "Invalid ephemeris_v1 artifact: supportedStartEpochTdbSec is after supportedEndEpochTdbSec",
    );
  }
  if (!isFiniteNumber(header.fitErrorDirectionDeg)) {
    throw new Error("Invalid ephemeris_v1 artifact: header.fitErrorDirectionDeg is not numeric");
  }
  const fitErrorMeasuredDirectionDeg = header.fitErrorMeasuredDirectionDeg;
  if (!isFiniteNumber(fitErrorMeasuredDirectionDeg)) {
    throw new Error("Invalid ephemeris_v1 artifact: header.fitErrorMeasuredDirectionDeg is not numeric");
  }

  if (!Array.isArray(input.segments) || input.segments.length === 0) {
    throw new Error("Invalid ephemeris_v1 artifact: segments must be a non-empty array");
  }
  const segments: EphemerisSegment[] = [];
  for (const rawSegment of input.segments) {
    if (!isRecord(rawSegment)) {
      throw new Error("Invalid ephemeris_v1 artifact: segment entries must be objects");
    }
    if (!isValidBodyPair(rawSegment.bodyPair)) {
      throw new Error(`Invalid ephemeris_v1 artifact: unsupported bodyPair ${String(rawSegment.bodyPair)}`);
    }
    if (!isFiniteNumber(rawSegment.startEpochTdbSec) || !isFiniteNumber(rawSegment.endEpochTdbSec)) {
      throw new Error(
        `Invalid ephemeris_v1 artifact: segment for ${String(rawSegment.bodyPair)} has non-numeric epochs`,
      );
    }
    if (rawSegment.endEpochTdbSec <= rawSegment.startEpochTdbSec) {
      throw new Error(
        `Invalid ephemeris_v1 artifact: segment for ${String(rawSegment.bodyPair)} must have endEpochTdbSec after startEpochTdbSec`,
      );
    }
    const rawChebyshev = rawSegment.chebyshev;
    if (!isRecord(rawChebyshev)) {
      throw new Error(
        `Invalid ephemeris_v1 artifact: segment for ${String(rawSegment.bodyPair)} is missing chebyshev`,
      );
    }
    const order = rawChebyshev.order;
    if (typeof order !== "number" || !Number.isInteger(order) || order < 0) {
      throw new Error(
        `Invalid ephemeris_v1 artifact: segment for ${String(rawSegment.bodyPair)} has invalid chebyshev order`,
      );
    }
    if (!Array.isArray(rawChebyshev.direction) || rawChebyshev.direction.length !== order + 1) {
      throw new Error(
        `Invalid ephemeris_v1 artifact: chebyshev.direction for ${String(rawSegment.bodyPair)} must have ${String(order + 1)} coefficients`,
      );
    }
    const direction: (readonly number[])[] = [];
    for (const coefficient of rawChebyshev.direction) {
      if (!Array.isArray(coefficient) || coefficient.length !== 3) {
        throw new Error(
          `Invalid ephemeris_v1 artifact: chebyshev.direction coefficients for ${String(rawSegment.bodyPair)} must be 3-component vectors`,
        );
      }
      if (!coefficient.every((component) => isFiniteNumber(component))) {
        throw new Error(
          `Invalid ephemeris_v1 artifact: chebyshev.direction coefficients for ${String(rawSegment.bodyPair)} must be finite`,
        );
      }
      direction.push(coefficient);
    }
    if (!Array.isArray(rawChebyshev.distanceKm) || rawChebyshev.distanceKm.length !== order + 1) {
      throw new Error(
        `Invalid ephemeris_v1 artifact: chebyshev.distanceKm for ${String(rawSegment.bodyPair)} must have ${String(order + 1)} coefficients`,
      );
    }
    if (!rawChebyshev.distanceKm.every((value) => isFiniteNumber(value))) {
      throw new Error(
        `Invalid ephemeris_v1 artifact: chebyshev.distanceKm coefficients for ${String(rawSegment.bodyPair)} must be finite`,
      );
    }

    segments.push({
      bodyPair: rawSegment.bodyPair,
      startEpochTdbSec: rawSegment.startEpochTdbSec,
      endEpochTdbSec: rawSegment.endEpochTdbSec,
      chebyshev: {
        order,
        direction,
        distanceKm: rawChebyshev.distanceKm,
      },
    });
  }

  return {
    schemaVersion: SUPPORTED_EPHEMERIS_SCHEMA_VERSION,
    header: {
      schemaVersion: SUPPORTED_EPHEMERIS_SCHEMA_VERSION,
      kernels: Array.isArray(header.kernels) ? (header.kernels as EphemerisHeader["kernels"]) : [],
      frame: header.frame,
      aberrationCorrection: header.aberrationCorrection,
      timeScale: header.timeScale,
      units: units as unknown as EphemerisUnits,
      supportedStartEpochTdbSec: header.supportedStartEpochTdbSec,
      supportedEndEpochTdbSec: header.supportedEndEpochTdbSec,
      fitErrorDirectionDeg: header.fitErrorDirectionDeg,
      fitErrorMeasuredDirectionDeg: fitErrorMeasuredDirectionDeg,
    },
    segments,
  };
}

/**
 * Select the contiguous fit segment covering `epochTdbSec` for a body pair. Fails
 * loudly when no segment covers the epoch.
 */
export function selectSegment(
  artifact: EphemerisArtifact,
  bodyPair: string,
  epochTdbSec: number,
): EphemerisSegment {
  const segment = artifact.segments.find(
    (candidate) =>
      candidate.bodyPair === bodyPair && epochTdbSec >= candidate.startEpochTdbSec && epochTdbSec <= candidate.endEpochTdbSec,
  );
  if (segment === undefined) {
    throw new Error(`No ephemeris segment for body pair ${bodyPair} covers epochTdbSec ${String(epochTdbSec)}`);
  }
  return segment;
}

/** Chebyshev basis function T_k(t) for normalized local coordinate t in [-1, 1]. */
function chebyshevT(k: number, t: number): number {
  if (k === 0) {
    return 1;
  }
  const clampedT = Math.min(1, Math.max(-1, t));
  return Math.cos(k * Math.acos(clampedT));
}

/** Evaluate the fitted Moon→body direction and distance at an epoch. */
export function evaluateChebyshev(
  segment: EphemerisSegment,
  epochTdbSec: number,
): { direction: [number, number, number]; distanceKm: number } {
  const spanSec = segment.endEpochTdbSec - segment.startEpochTdbSec;
  const t = (2 * (epochTdbSec - segment.startEpochTdbSec)) / spanSec - 1;
  const order = segment.chebyshev.order;
  const chebyshev = segment.chebyshev;
  let directionX = 0;
  let directionY = 0;
  let directionZ = 0;
  let distanceKm = 0;
  for (let k = 0; k <= order; k += 1) {
    const basisCoefficient = chebyshevT(k, t);
    const coefficient = chebyshev.direction[k];
    directionX += coefficient[0] * basisCoefficient;
    directionY += coefficient[1] * basisCoefficient;
    directionZ += coefficient[2] * basisCoefficient;
    distanceKm += chebyshev.distanceKm[k] * basisCoefficient;
  }
  return { direction: [directionX, directionY, directionZ], distanceKm };
}
