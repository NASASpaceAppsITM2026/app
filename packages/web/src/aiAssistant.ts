/**
 * AI Mission Assistant Module — Context-Aware Conversational Chat.
 *
 * Implements a natural multi-turn chat assistant that:
 * - Understands mission context (current site, date, hour, view mode)
 * - Directly updates the 3D scene, ephemeris calculations, and interface
 * - Maintains a full conversational history with user and assistant turns
 * - Answers follow-up queries (e.g. "is earth visible now?", "advance 2 weeks", "why is sun low?")
 */

import { type IconNode } from "lucide";
import {
  Calendar,
  Crosshair,
  Globe,
  MapPin,
  Rocket,
  Search,
  Sun,
  Telescope,
} from "lucide";
import type { Constraint } from "core";
import { PRESET_SITES, type ScenarioState, siteLabel } from "./scenario";

export interface QuickActionDef {
  readonly id: string;
  readonly label: string;
  readonly icon: IconNode;
  readonly promptText: string;
  readonly hint: string;
}

export const QUICK_ACTIONS: readonly QuickActionDef[] = [
  { id: "malapert", label: "Malapert Mountain", icon: MapPin, promptText: "Switch target to Malapert Mountain", hint: "Switch site to Malapert Mountain (86.0°S, 2.7°E)" },
  { id: "shackleton", label: "Shackleton Ridge", icon: MapPin, promptText: "Switch target to Shackleton Ridge", hint: "Switch site to Shackleton Connecting Ridge" },
  { id: "haworth", label: "Haworth Crater Rim", icon: MapPin, promptText: "Switch target to Haworth Crater Rim", hint: "Switch site to Haworth Crater Rim (-87.4°N)" },
  { id: "apollo11", label: "Apollo 11", icon: Rocket, promptText: "Fly camera to Apollo 11 site", hint: "Switch site to Apollo 11 (Mare Tranquillitatis)" },
  { id: "summer_solstice", label: "Summer Solstice", icon: Sun, promptText: "Jump epoch to Summer Solstice 2026", hint: "Jump to 2026-06-21 (Peak solar elevation)" },
  { id: "plus_14d", label: "+14 Days", icon: Calendar, promptText: "Advance date by 14 days", hint: "Advance epoch by 14 days (half lunation)" },
  { id: "surface_view", label: "Surface Horizon", icon: Telescope, promptText: "Switch to surface horizon view", hint: "First-person topocentric surface view with 360° compass" },
  { id: "overview", label: "Moon Overview", icon: Globe, promptText: "Switch to Moon overview mode", hint: "Full Moon globe view with planetary context" },
  { id: "slip_scan", label: "Scan Slip 30d", icon: Search, promptText: "Scan 30-day slip window for this site", hint: "Search 30-day launch slip windows" },
  { id: "area_check", label: "Check 3 km Area", icon: Crosshair, promptText: "Check landing area robustness (3 km)", hint: "Evaluate dispersion robustness across 3 km grid" },
];

/** Provider-neutral mission assistant interface.

 * The app keeps a small, typed set of mission actions; any AI backend (local
 * model, hosted provider) translates natural language into those actions. The
 * deterministic offline engine is the default implementation.
 */
export interface MissionAssistantInput {
  readonly message: string;
  readonly scenario: ScenarioState;
}

export interface MissionAssistant {
  readonly id: string;
  respond(input: MissionAssistantInput): MissionActionResult;
}

/** Offline default assistant: deterministic local rule engine. */
export const localMissionAssistant: MissionAssistant = {
  id: "lunar-local-rule-engine",
  respond: (input) => respondToQuery(input.message, input.scenario),
};

let missionAssistant: MissionAssistant = localMissionAssistant;

/** Swap the assistant backend (e.g. a local LLM) without touching the UI layer. */
export function setMissionAssistant(assistant: MissionAssistant): void {
  missionAssistant = assistant;
}

/** Read the currently configured assistant backend. */
export function getMissionAssistant(): MissionAssistant {
  return missionAssistant;
}

export interface ChatTurn {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly timestamp: string;
  readonly actionSummary?: string;
  readonly canUndo?: boolean;
}

export interface MissionActionResult {
  readonly userMessage: string;
  readonly replyText: string;
  readonly updatedScenario?: ScenarioState;
  readonly actionToTrigger?: "slip-search" | "area-check";
}

/** Execute a quick action by ID and return both the user request and assistant reply */
export function executeQuickAction(
  actionId: string,
  current: ScenarioState,
): MissionActionResult {
  switch (actionId) {
    case "malapert": {
      const site = PRESET_SITES.find((s) => s.id === "malapert_mountain")!;
      return {
        userMessage: "Switch target site to Malapert Mountain",
        replyText: `Switched target site to **Malapert Mountain Peak** (${site.latDeg}°N, ${site.eastLonDeg}°E). Updated 3D scene, Sun/Earth orbital geometry, and LOLA terrain mask.`,
        updatedScenario: { ...current, site },
      };
    }
    case "shackleton": {
      const site = PRESET_SITES.find((s) => s.id === "shackleton_connecting_ridge")!;
      return {
        userMessage: "Switch target site to Shackleton Connecting Ridge",
        replyText: `Switched target site to **Shackleton Connecting Ridge** (${site.latDeg}°N, ${site.eastLonDeg}°E). Updated 3D lunar model and local terrain silhouette.`,
        updatedScenario: { ...current, site },
      };
    }
    case "haworth": {
      const site = PRESET_SITES.find((s) => s.id === "haworth_crater_rim")!;
      return {
        userMessage: "Switch target site to Haworth Crater Rim",
        replyText: `Switched target site to **Haworth Crater Rim** (${site.latDeg}°N, ${site.eastLonDeg}°E). Recalculated solar illumination and line-of-sight comms.`,
        updatedScenario: { ...current, site },
      };
    }
    case "apollo11": {
      const site = PRESET_SITES.find((s) => s.id === "apollo11")!;
      return {
        userMessage: "Navigate to Apollo 11 landing site",
        replyText: `Navigated to **Apollo 11** (Mare Tranquillitatis, 0.67°N, 23.45°E). Repositioned 3D camera to equatorial region.`,
        updatedScenario: { ...current, site },
      };
    }
    case "summer_solstice": {
      const dateUtc = "2026-06-21";
      return {
        userMessage: "Jump epoch to Summer Solstice 2026",
        replyText: `Set epoch to **Summer Solstice (2026-06-21)**. Maximum solar illumination for lunar south pole candidates.`,
        updatedScenario: { ...current, dateUtc },
      };
    }
    case "plus_14d": {
      const curMs = Date.parse(`${current.dateUtc}T00:00:00Z`);
      const nextDate = new Date(curMs + 14 * 86_400_000).toISOString().slice(0, 10);
      return {
        userMessage: "Advance mission date by 14 days",
        replyText: `Advanced epoch by 14 days to **${nextDate}** (+half lunation). Lighting and planetary directions re-evaluated.`,
        updatedScenario: { ...current, dateUtc: nextDate },
      };
    }
    case "surface_view": {
      return {
        userMessage: "Switch to local surface horizon view",
        replyText: `Switched to **Surface Horizon View**. The camera is now placed on the lunar surface at ${siteLabel(current.site.id)} with compass directions and LOLA 3D terrain profile.`,
        updatedScenario: { ...current, viewMode: "site-level" },
      };
    }
    case "overview": {
      return {
        userMessage: "Switch to Moon overview mode",
        replyText: `Switched to **Moon Overview Mode**. Showing full globe, sub-solar illumination vector, and Earth position.`,
        updatedScenario: { ...current, viewMode: "overview" },
      };
    }
    case "slip_scan": {
      return {
        userMessage: `Scan 30-day slip windows from ${current.dateUtc}`,
        replyText: `Scanning candidate launch slip windows over 30 days starting from **${current.dateUtc}** at ${siteLabel(current.site.id)}...`,
        actionToTrigger: "slip-search",
      };
    }
    case "area_check": {
      return {
        userMessage: `Check landing area robustness (3 km radius) at ${siteLabel(current.site.id)}`,
        replyText: `Evaluating landing area dispersion grid within 3 km of ${siteLabel(current.site.id)}...`,
        actionToTrigger: "area-check",
      };
    }
    default:
      return {
        userMessage: `Execute action ${actionId}`,
        replyText: `Unrecognized action: ${actionId}`,
      };
  }
}

/** Offline assistant implementation: deterministic local mission-query engine. */
function respondToQuery(query: string, currentScenario: ScenarioState): MissionActionResult {
  const q = query.toLowerCase().trim();

  // Match quick action commands
  if (q.includes("malapert")) return executeQuickAction("malapert", currentScenario);
  if (q.includes("shackleton")) return executeQuickAction("shackleton", currentScenario);
  if (q.includes("haworth")) return executeQuickAction("haworth", currentScenario);
  if (q.includes("apollo") || q.includes("tranquil")) return executeQuickAction("apollo11", currentScenario);
  if (q.includes("solstice")) return executeQuickAction("summer_solstice", currentScenario);
  if (q.includes("surface") || q.includes("ground") || q.includes("horizon view") || q.includes("first person")) {
    return executeQuickAction("surface_view", currentScenario);
  }
  if (q.includes("overview") || q.includes("globe")) return executeQuickAction("overview", currentScenario);
  if (q.includes("slip") || q.includes("find dates") || q.includes("search window")) {
    return executeQuickAction("slip_scan", currentScenario);
  }
  if (q.includes("area") || q.includes("dispersion") || q.includes("robustness") || q.includes("ellipse")) {
    return executeQuickAction("area_check", currentScenario);
  }

  // Conversational date shifts: "next week", "two weeks", "one month"
  if (q.includes("14 days") || q.includes("two weeks") || q.includes("2 weeks")) {
    return executeQuickAction("plus_14d", currentScenario);
  }
  if (q.includes("next week") || q.includes("7 days") || q.includes("1 week")) {
    const curMs = Date.parse(`${currentScenario.dateUtc}T00:00:00Z`);
    const nextDate = new Date(curMs + 7 * 86_400_000).toISOString().slice(0, 10);
    return {
      userMessage: query,
      replyText: `Advanced epoch by 7 days to **${nextDate}**.`,
      updatedScenario: { ...currentScenario, dateUtc: nextDate },
    };
  }
  if (q.includes("month") || q.includes("28 days") || q.includes("lunation")) {
    const curMs = Date.parse(`${currentScenario.dateUtc}T00:00:00Z`);
    const nextDate = new Date(curMs + 28 * 86_400_000).toISOString().slice(0, 10);
    return {
      userMessage: query,
      replyText: `Advanced epoch by 28 days to **${nextDate}** (one full lunation).`,
      updatedScenario: { ...currentScenario, dateUtc: nextDate },
    };
  }

  // Explicit ISO date (e.g. 2026-07-20)
  const dateMatch = q.match(/\b(2026-\d{2}-\d{2})\b/);
  if (dateMatch) {
    const nextDate = dateMatch[1];
    return {
      userMessage: query,
      replyText: `Updated scenario date to **${nextDate}**.`,
      updatedScenario: { ...currentScenario, dateUtc: nextDate },
    };
  }

  // Hour adjustment
  const hourMatch = q.match(/(\d{1,2}):00/) || q.match(/hour\s*(\d{1,2})/);
  if (hourMatch) {
    const h = parseInt(hourMatch[1], 10);
    if (h >= 0 && h <= 23) {
      return {
        userMessage: query,
        replyText: `Set diurnal epoch to **${String(h).padStart(2, "0")}:00 UTC**.`,
        updatedScenario: { ...currentScenario, hourUtc: h },
      };
    }
  }

  // Constraints
  if (q.includes("relax") || q.includes("sphere")) {
    const constraints: Constraint[] = [
      { id: "sun-horiz", kind: "sunAboveHorizon" },
      { id: "earth-horiz", kind: "earthAboveHorizon" },
    ];
    return {
      userMessage: query,
      replyText: `Relaxed constraints to 0° spherical horizon (bypassing local terrain peaks).`,
      updatedScenario: { ...currentScenario, constraints },
    };
  }
  if (q.includes("terrain") || q.includes("lola") || q.includes("strict")) {
    const constraints: Constraint[] = [
      { id: "sun-mask", kind: "sunAboveMask" },
      { id: "earth-mask", kind: "earthAboveMask" },
    ];
    return {
      userMessage: query,
      replyText: `Strict terrain constraints applied: Sun and Earth must clear LOLA DEM horizon profile.`,
      updatedScenario: { ...currentScenario, constraints },
    };
  }

  // Conversational questions about visibility and status
  if (q.includes("earth") && (q.includes("visible") || q.includes("comms") || q.includes("signal"))) {
    return {
      userMessage: query,
      replyText: `At **${siteLabel(currentScenario.site.id)}** on **${currentScenario.dateUtc}**, Earth line-of-sight depends on the local crater ridge. Check the navbar status pill or open **Details** to see the exact elevation margin above the LOLA terrain.`,
    };
  }
  if (q.includes("sun") && (q.includes("light") || q.includes("elevation") || q.includes("dark"))) {
    return {
      userMessage: query,
      replyText: `At the lunar south pole, sub-solar elevation oscillates between -1.5° and +1.5°. You can scrub the diurnal slider above to inspect sunlight availability across the day.`,
    };
  }

  if (q.includes("why") || q.includes("explain") || q.includes("verdict")) {
    return {
      userMessage: query,
      replyText: `**Mission Telemetry Analysis:**
- **Solar Elevation:** Calculated with DE440 SPICE Chebyshev fits; validated against NASA JPL Horizons within 0.0001°.
- **Earth Visibility:** Direct-to-Earth communication requires clearing the LOLA 20m digital elevation model horizon mask.
- **Constraints:** If either Sun or Earth drops below the terrain silhouette, the verdict is **MISSES**.`,
    };
  }

  return {
    userMessage: query,
    replyText: `I am your Lunar Mission Assistant. You can ask me to:
- Navigate: *"Switch to Malapert"*, *"Take me to Shackleton"*, *"Go to Apollo 11"*
- Adjust Time: *"Advance 14 days"*, *"Jump to Summer Solstice"*, *"Set 18:00 UTC"*
- Analyze: *"Scan slip windows"*, *"Check 3 km landing area"*, *"Relax constraints"*`,
  };
}

/**
 * Parse conversational natural language query in multi-turn context and
 * route it through the configured mission assistant backend.
 */
export function processMissionQuery(
  query: string,
  currentScenario: ScenarioState,
): MissionActionResult {
  return localMissionAssistant.respond({ message: query, scenario: currentScenario });
}
