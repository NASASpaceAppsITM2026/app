/**
 * Horizon masks artifact (`horizon_masks_v1`) types and validation.
 *
 * Implements the contract defined in `docs/data-contracts.md` §5.
 */

export const SUPPORTED_MASKS_SCHEMA_VERSION = 1;

export interface HorizonMaskHeader {
  readonly schemaVersion: number;
  readonly demProductName: string;
  readonly demVersion: string;
  readonly demSha256: string;
  readonly resolutionM: number;
  readonly sphereRadiusKm: number;
  readonly observerHeightKm: number;
  readonly azimuthStepDeg: number;
  readonly maxRayRangeKm: number;
  readonly status: "ok" | "missing_coverage" | "insufficient_coverage";
}

export interface HorizonMaskSiteRecord {
  readonly id: string;
  readonly eastLonDeg: number;
  readonly latDeg: number;
  readonly elevationDeg: readonly number[];
  readonly status?: "ok" | "missing_coverage" | "insufficient_coverage";
}

export interface HorizonMasksArtifact {
  readonly schemaVersion: number;
  readonly header: HorizonMaskHeader;
  readonly sites: readonly HorizonMaskSiteRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateHorizonMasksArtifact(input: unknown): HorizonMasksArtifact {
  if (!isRecord(input)) {
    throw new Error("Invalid horizon_masks_v1 artifact: expected an object");
  }
  if (input.schemaVersion !== SUPPORTED_MASKS_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported horizon masks schema version: expected ${SUPPORTED_MASKS_SCHEMA_VERSION}, got ${String(input.schemaVersion)}`,
    );
  }
  if (!isRecord(input.header)) {
    throw new Error("Invalid horizon_masks_v1 artifact: missing or invalid header");
  }
  const header = input.header;
  if (typeof header.demProductName !== "string" || header.demProductName.length === 0) {
    throw new Error("Invalid horizon_masks_v1 artifact: header.demProductName missing");
  }
  if (!Array.isArray(input.sites) || input.sites.length === 0) {
    throw new Error("Invalid horizon_masks_v1 artifact: sites must be a non-empty array");
  }

  const sites: HorizonMaskSiteRecord[] = [];
  for (const rawSite of input.sites) {
    if (!isRecord(rawSite)) {
      throw new Error("Invalid horizon_masks_v1 artifact: site entry must be an object");
    }
    if (typeof rawSite.id !== "string" || rawSite.id.length === 0) {
      throw new Error("Invalid horizon_masks_v1 artifact: site missing id");
    }
    if (typeof rawSite.latDeg !== "number" || typeof rawSite.eastLonDeg !== "number") {
      throw new Error(`Invalid horizon_masks_v1 artifact: site ${rawSite.id} has non-numeric coordinates`);
    }
    if (!Array.isArray(rawSite.elevationDeg) || rawSite.elevationDeg.length === 0) {
      throw new Error(`Invalid horizon_masks_v1 artifact: site ${rawSite.id} missing elevationDeg array`);
    }

    sites.push({
      id: rawSite.id,
      latDeg: rawSite.latDeg,
      eastLonDeg: rawSite.eastLonDeg,
      elevationDeg: rawSite.elevationDeg as readonly number[],
      status: (rawSite.status as HorizonMaskSiteRecord["status"]) ?? "ok",
    });
  }

  return {
    schemaVersion: SUPPORTED_MASKS_SCHEMA_VERSION,
    header: header as unknown as HorizonMaskHeader,
    sites,
  };
}
