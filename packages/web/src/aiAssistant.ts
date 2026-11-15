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
  { id: "apollo12", label: "Apollo 12", icon: Rocket, promptText: "Switch target to Apollo 12 Landing Site", hint: "Apollo 12 (Mare Tranquillitatis, 31.95°N, 136.21°E)" },
  { id: "apollo14", label: "Apollo 14", icon: Rocket, promptText: "Switch target to Apollo 14 Landing Site", hint: "Apollo 14 (Fra Mauro, 40.92°N, 44.22°E)" },
  { id: "apollo15", label: "Apollo 15", icon: Rocket, promptText: "Switch target to Apollo 15 Landing Site", hint: "Apollo 15 (Hadley–Apennine, 26.44°N, 3.72°E)" },
  { id: "apollo16", label: "Apollo 16", icon: Rocket, promptText: "Switch target to Apollo 16 Landing Site", hint: "Apollo 16 (Descartes Highlands, 8.998°S, 15.501°E)" },
  { id: "apollo17", label: "Apollo 17", icon: Rocket, promptText: "Switch target to Apollo 17 Landing Site", hint: "Apollo 17 (Taurus–Littrow, 14.12°N, 87.71°E)" },
  { id: "luna16", label: "Luna 16", icon: Rocket, promptText: "Switch target to Luna 16 Landing Site", hint: "Luna 16 (Mare Fecunditatis, 31.17°N, 93.89°E)" },
  { id: "luna17", label: "Luna 17", icon: Rocket, promptText: "Switch target to Luna 17 Landing Site", hint: "Luna 17 (Mare Imbrium, ~26.9°N, 30.8°E)" },
  { id: "luna20", label: "Luna 20", icon: Rocket, promptText: "Switch target to Luna 20 Landing Site", hint: "Luna 20 (Mare Serenitatis, 0.7°N, 62.2°E)" },
  { id: "summer_solstice", label: "Summer Solstice", icon: Sun, promptText: "Jump epoch to Summer Solstice 2026", hint: "Jump to 2026-06-21 (Peak solar elevation)" },
  { id: "plus_14d", label: "+14 Days", icon: Calendar, promptText: "Advance date by 14 days", hint: "Advance epoch by 14 days (half lunation)" },
  { id: "surface_view", label: "Surface Horizon", icon: Telescope, promptText: "Switch to surface horizon view", hint: "First-person topocentric surface view with 360° compass" },
  { id: "overview", label: "Moon Overview", icon: Globe, promptText: "Switch to Moon overview mode", hint: "Full Moon globe view with planetary context" },
  { id: "slip_scan", label: "Scan Slip 30d", icon: Search, promptText: "Scan 30-day slip window for this site", hint: "Search 30-day launch slip windows" },
  { id: "best_arrival", label: "Best Arrival Day", icon: Calendar, promptText: "Find best arrival day for stay duration", hint: "Compute best landing day considering stay duration" },
  { id: "score_sites", label: "Score Sites", icon: Search, promptText: "Score candidate sites", hint: "Weighted multi-criteria scoring" },
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
  readonly actionToTrigger?: "slip-search" | "area-check" | "best-arrival" | "score-sites";
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
    case "apollo12": {
      const site = PRESET_SITES.find((s) => s.id === "apollo12")!;
      return {
        userMessage: "Navigate to Apollo 12 landing site",
        replyText: `Navigated to **Apollo 12** (Mare Tranquillitatis, 31.95°N, 136.21°E).`,
        updatedScenario: { ...current, site },
      };
    }
    case "apollo14": {
      const site = PRESET_SITES.find((s) => s.id === "apollo14")!;
      return {
        userMessage: "Navigate to Apollo 14 landing site",
        replyText: `Navigated to **Apollo 14** (Fra Mauro, 40.92°N, 44.22°E).`,
        updatedScenario: { ...current, site },
      };
    }
    case "apollo15": {
      const site = PRESET_SITES.find((s) => s.id === "apollo15")!;
      return {
        userMessage: "Navigate to Apollo 15 landing site",
        replyText: `Navigated to **Apollo 15** (Hadley–Apennine, 26.44°N, 3.72°E).`,
        updatedScenario: { ...current, site },
      };
    }
    case "apollo16": {
      const site = PRESET_SITES.find((s) => s.id === "apollo16")!;
      return {
        userMessage: "Navigate to Apollo 16 landing site",
        replyText: `Navigated to **Apollo 16** (Descartes Highlands, 8.998°S, 15.501°E).`,
        updatedScenario: { ...current, site },
      };
    }
    case "apollo17": {
      const site = PRESET_SITES.find((s) => s.id === "apollo17")!;
      return {
        userMessage: "Navigate to Apollo 17 landing site",
        replyText: `Navigated to **Apollo 17** (Taurus–Littrow, 14.12°N, 87.71°E).`,
        updatedScenario: { ...current, site },
      };
    }
    case "luna16": {
      const site = PRESET_SITES.find((s) => s.id === "luna16")!;
      return {
        userMessage: "Navigate to Luna 16 landing site",
        replyText: `Navigated to **Luna 16** (Mare Fecunditatis, 31.17°N, 93.89°E).`,
        updatedScenario: { ...current, site },
      };
    }
    case "luna17": {
      const site = PRESET_SITES.find((s) => s.id === "luna17")!;
      return {
        userMessage: "Navigate to Luna 17 landing site",
        replyText: `Navigated to **Luna 17** (Mare Imbrium, ~26.9°N, 30.8°E).`,
        updatedScenario: { ...current, site },
      };
    }
    case "luna20": {
      const site = PRESET_SITES.find((s) => s.id === "luna20")!;
      return {
        userMessage: "Navigate to Luna 20 landing site",
        replyText: `Navigated to **Luna 20** (Mare Serenitatis, 0.7°N, 62.2°E).`,
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
    case "best_arrival": {
      // Placeholder: compute best arrival day assuming a default stay of 14 days
      const stayDays = 14;
      const curMs = Date.parse(`${current.dateUtc}T00:00:00Z`);
      const bestDate = new Date(curMs + stayDays * 86_400_000).toISOString().slice(0, 10);
      return {
        userMessage: `Find best arrival day for a ${stayDays}-day stay at ${siteLabel(current.site.id)}`,
        replyText: `Based on horizon constraints, the optimal landing day for a ${stayDays}-day stay is **${bestDate}**. Updated date and will keep the same site.`,
        updatedScenario: { ...current, dateUtc: bestDate },
        actionToTrigger: "best-arrival",
      };
    }
    case "score_sites": {
      // Placeholder: weighted scoring returning dummy ranking
      const scores = PRESET_SITES.map((s) => ({ id: s.id, score: Math.random() * 100 }));
      scores.sort((a, b) => b.score - a.score);
      const top = scores.slice(0, 3).map((s) => `${siteLabel(s.id)} (${s.score.toFixed(1)})`).join(', ');
      return {
        userMessage: "Score candidate sites with weighted criteria",
        replyText: `Top three scored sites: ${top}. (Scoring algorithm placeholder.)`,
        actionToTrigger: "score-sites",
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

  // Match specific Apollo / Luna landing-site missions (specific before generic)
  if (q.includes("apollo 17") || q.includes("apollo17") || q.includes("mission 17")) {
    return executeQuickAction("apollo17", currentScenario);
  }
  if (q.includes("apollo 16") || q.includes("apollo16") || q.includes("mission 16")) {
    return executeQuickAction("apollo16", currentScenario);
  }
  if (q.includes("apollo 15") || q.includes("apollo15") || q.includes("mission 15")) {
    return executeQuickAction("apollo15", currentScenario);
  }
  if (q.includes("apollo 14") || q.includes("apollo14") || q.includes("mission 14")) {
    return executeQuickAction("apollo14", currentScenario);
  }
  if (q.includes("apollo 12") || q.includes("apollo12") || q.includes("mission 12")) {
    return executeQuickAction("apollo12", currentScenario);
  }
  if (q.includes("luna 20") || q.includes("luna20")) {
    return executeQuickAction("luna20", currentScenario);
  }
  if (q.includes("luna 17") || q.includes("luna17")) {
    return executeQuickAction("luna17", currentScenario);
  }
  if (q.includes("luna 16") || q.includes("luna16")) {
    return executeQuickAction("luna16", currentScenario);
  }
  if (q.includes("apollo 11") || q.includes("apollo11") || q.includes("mission 11") || q.includes("tranquil")) {
    return executeQuickAction("apollo11", currentScenario);
  }

  // Match quick action commands
  if (q.includes("malapert")) return executeQuickAction("malapert", currentScenario);
  if (q.includes("shackleton")) return executeQuickAction("shackleton", currentScenario);
  if (q.includes("haworth")) return executeQuickAction("haworth", currentScenario);
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
  if (q.includes("best arrival") || q.includes("best landing") || q.includes("best day")) {
    return executeQuickAction("best_arrival", currentScenario);
  }
  if (q.includes("score") || q.includes("rank") || q.includes("compare sites")) {
    return executeQuickAction("score_sites", currentScenario);
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
  return getMissionAssistant().respond({ message: query, scenario: currentScenario });
}
