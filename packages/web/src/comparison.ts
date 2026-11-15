/**
 * Multi-Scenario Comparison Module.
 *
 * Allows mission planners to pin 2 to 4 candidate scenarios and evaluate their
 * orbital geometry, illumination, direct-to-Earth communication links, and constraint
 * verdicts side by side with clear diff indicators.
 */

import type { ConstraintRow } from "./science";
import {
  type ScenarioState,
  PRESET_SITES,
  siteLabel,
} from "./scenario";
import type { SkyState, Verdict } from "core";
import {
  skyAtForDate,
  horizonMaskForSite,
  evaluateUiConstraints,
  maskElevationAt,
  horizontalPowerProxy,
} from "./science";

export interface EvaluatedScenario {
  readonly id: string;
  readonly label: string;
  readonly scenario: ScenarioState;
  readonly sky: SkyState;
  readonly sunAboveMask: boolean;
  readonly earthAboveMask: boolean;
  readonly powerProxy: number;
  readonly constraintRows: readonly ConstraintRow[];
  readonly overallVerdict: Verdict;
}

/** Predefined scenario comparisons for quick mission trade studies */
export const PRESET_COMPARISONS: Array<{ title: string; scenarios: ScenarioState[] }> = [
  {
    title: "Artemis III South Pole Candidates (June 2026)",
    scenarios: [
      {
        version: "1",
        site: PRESET_SITES[0], // Shackleton
        dateUtc: "2026-06-15",
        hourUtc: 12,
        viewMode: "overview",
        constraints: [
          { id: "sun-mask", kind: "sunAboveMask" },
          { id: "earth-mask", kind: "earthAboveMask" },
        ],
      },
      {
        version: "1",
        site: PRESET_SITES[1], // Malapert Mountain
        dateUtc: "2026-06-15",
        hourUtc: 12,
        viewMode: "overview",
        constraints: [
          { id: "sun-mask", kind: "sunAboveMask" },
          { id: "earth-mask", kind: "earthAboveMask" },
        ],
      },
      {
        version: "1",
        site: PRESET_SITES[3], // Haworth
        dateUtc: "2026-06-15",
        hourUtc: 12,
        viewMode: "overview",
        constraints: [
          { id: "sun-mask", kind: "sunAboveMask" },
          { id: "earth-mask", kind: "earthAboveMask" },
        ],
      },
    ],
  },
  {
    title: "Summer vs Winter Solstice (Shackleton)",
    scenarios: [
      {
        version: "1",
        site: PRESET_SITES[0],
        dateUtc: "2026-06-21", // Lunar South Pole Winter / Low Sun
        hourUtc: 12,
        viewMode: "overview",
        constraints: [
          { id: "sun-mask", kind: "sunAboveMask" },
          { id: "earth-mask", kind: "earthAboveMask" },
        ],
      },
      {
        version: "1",
        site: PRESET_SITES[0],
        dateUtc: "2026-12-21", // Lunar South Pole Summer / Higher Sun
        hourUtc: 12,
        viewMode: "overview",
        constraints: [
          { id: "sun-mask", kind: "sunAboveMask" },
          { id: "earth-mask", kind: "earthAboveMask" },
        ],
      },
    ],
  },
];

/** Evaluate a single scenario into a full comparison record */
export async function evaluateScenario(
  scenario: ScenarioState,
  label = "",
): Promise<EvaluatedScenario> {
  const sky = await skyAtForDate(scenario.site, scenario.dateUtc, scenario.hourUtc ?? 12);
  const { mask } = await horizonMaskForSite(scenario.site);

  const sunMaskElev = maskElevationAt(mask, sky.sunAzimuthDeg);
  const earthMaskElev = maskElevationAt(mask, sky.earthAzimuthDeg);

  const sunAboveMask = sky.sunElevationDeg > sunMaskElev;
  const earthAboveMask = sky.earthElevationDeg > earthMaskElev;
  const powerProxy = horizontalPowerProxy(sky.sunElevationDeg, sunAboveMask);

  const constraintRows = evaluateUiConstraints(scenario.constraints, sky, mask);
  let overallVerdict: Verdict = "meets";
  if (constraintRows.some((r) => r.verdict === "misses")) overallVerdict = "misses";
  else if (constraintRows.some((r) => r.verdict === "unknown")) overallVerdict = "unknown";
  if (scenario.constraints.length === 0) overallVerdict = "meets";

  const resolvedLabel = label || `${siteLabel(scenario.site.id)} @ ${scenario.dateUtc}`;

  return {
    id: `eval-${scenario.site.id}-${scenario.dateUtc}-${scenario.hourUtc}`,
    label: resolvedLabel,
    scenario,
    sky,
    sunAboveMask,
    earthAboveMask,
    powerProxy,
    constraintRows,
    overallVerdict,
  };
}
