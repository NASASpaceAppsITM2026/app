export * from "./contracts";
export {
  SUPPORTED_MASKS_SCHEMA_VERSION,
  type HorizonMaskHeader,
  type HorizonMaskSiteRecord,
  type HorizonMasksArtifact,
  configureHorizonMasksArtifact,
  horizonElevationAt,
  horizonMaskFor as coreHorizonMaskFor,
  resetConfiguredHorizonMasksArtifact,
  validateHorizonMasksArtifact,
} from "./terrain";
