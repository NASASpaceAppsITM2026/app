import { describe, expect, it } from "vitest";
import {
  defaultScenario,
  scenarioToQuery,
  scenarioFromQuery,
  PRESET_SITES,
  siteLabel,
} from "../src/scenario";
import {
  QUICK_ACTIONS,
  executeQuickAction,
  processMissionQuery,
} from "../src/aiAssistant";
import { evaluateScenario, PRESET_COMPARISONS } from "../src/comparison";
import {
  horizontalPowerProxy,
  maskElevationAt,
  horizonsVerifyUrl,
  calculateDiurnalTimeline,
} from "../src/science";

describe("scenario state and serialization", () => {
  it("serializes and deserializes ScenarioState correctly with hour and view mode", () => {
    const original = defaultScenario();
    const query = scenarioToQuery(original);

    expect(query.v).toBe("1");
    expect(query.site).toBe("shackleton_connecting_ridge");
    expect(query.date).toBe("2026-06-15");
    expect(query.hour).toBe("12");
    expect(query.view).toBe("overview");

    const params = new URLSearchParams(query);
    const restored = scenarioFromQuery(params);

    expect(restored.site.id).toBe(original.site.id);
    expect(restored.dateUtc).toBe(original.dateUtc);
    expect(restored.hourUtc).toBe(original.hourUtc);
    expect(restored.viewMode).toBe("overview");
  });

  it("handles legacy site ID aliases", () => {
    const params = new URLSearchParams({ site: "shackleton-rim" });
    const restored = scenarioFromQuery(params);
    expect(restored.site.id).toBe("shackleton_connecting_ridge");
  });

  it("generates human-readable site labels", () => {
    expect(siteLabel("shackleton_connecting_ridge")).toBe("Shackleton Connecting Ridge");
    expect(siteLabel("malapert_mountain")).toBe("Malapert Mountain Peak");
    expect(siteLabel("apollo11")).toBe("Apollo 11 Landing Site");
  });
});

describe("AI Mission Assistant & Quick Action execution", () => {
  it("has valid quick actions defined", () => {
    expect(QUICK_ACTIONS.length).toBeGreaterThanOrEqual(6);
  });

  it("directly updates scenario when quick action 'malapert' is triggered", () => {
    const scenario = defaultScenario();
    const res = executeQuickAction("malapert", scenario);

    expect(res.updatedScenario).toBeDefined();
    expect(res.updatedScenario?.site.id).toBe("malapert_mountain");
    expect(res.replyText).toContain("Malapert Mountain");
  });

  it("directly updates date when quick action 'plus_14d' is triggered", () => {
    const scenario = defaultScenario();
    const res = executeQuickAction("plus_14d", scenario);

    expect(res.updatedScenario).toBeDefined();
    expect(res.updatedScenario?.dateUtc).toBe("2026-06-29");
  });

  it("directly updates view when quick action 'surface_view' is triggered", () => {
    const scenario = defaultScenario();
    const res = executeQuickAction("surface_view", scenario);

    expect(res.updatedScenario).toBeDefined();
    expect(res.updatedScenario?.viewMode).toBe("site-level");
  });

  it("processes free-form natural language and updates scenario directly", () => {
    const scenario = defaultScenario();
    const res = processMissionQuery("switch to Apollo 11 please", scenario);

    expect(res.updatedScenario).toBeDefined();
    expect(res.updatedScenario?.site.id).toBe("apollo11");
    expect(res.replyText).toContain("Apollo 11");
  });

  it("provides scientific explanations for why verdicts fail", () => {
    const scenario = defaultScenario();
    const res = processMissionQuery("Why did my constraint fail?", scenario);

    expect(res.updatedScenario).toBeUndefined();
    expect(res.replyText).toContain("Mission Telemetry Analysis");
    expect(res.replyText).toContain("LOLA");
  });
});

describe("multi-scenario comparison", () => {
  it("evaluates a candidate scenario into a full comparison record", async () => {
    const scenario = defaultScenario();
    const evaluated = await evaluateScenario(scenario, "Candidate Alpha");

    expect(evaluated.label).toBe("Candidate Alpha");
    expect(evaluated.sky).toBeDefined();
    expect(evaluated.powerProxy).toBeGreaterThanOrEqual(0);
    expect(evaluated.powerProxy).toBeLessThanOrEqual(1);
    expect(["meets", "misses", "unknown"]).toContain(evaluated.overallVerdict);
  });

  it("has valid preset comparisons defined", () => {
    expect(PRESET_COMPARISONS.length).toBeGreaterThan(0);
    expect(PRESET_COMPARISONS[0].scenarios.length).toBeGreaterThanOrEqual(2);
  });
});

describe("science calculations and helpers", () => {
  it("calculates horizontal power proxy correctly", () => {
    expect(horizontalPowerProxy(0, true)).toBe(0);
    expect(horizontalPowerProxy(-5, true)).toBe(0);
    expect(horizontalPowerProxy(30, false)).toBe(0);
    expect(horizontalPowerProxy(30, true)).toBeCloseTo(0.5, 3);
    expect(horizontalPowerProxy(90, true)).toBeCloseTo(1.0, 3);
  });

  it("interpolates horizon mask elevation smoothly", () => {
    const mask = {
      siteId: "test",
      eastLonDeg: 0,
      latDeg: 0,
      elevationDeg: [0, 10, 20, 10],
      status: "ok" as const,
    };
    expect(maskElevationAt(mask, 0)).toBeCloseTo(0);
    expect(maskElevationAt(mask, 90)).toBeCloseTo(10);
    expect(maskElevationAt(mask, 180)).toBeCloseTo(20);
    expect(maskElevationAt(mask, 45)).toBeCloseTo(5);
  });

  it("generates authoritative Horizons query URLs", () => {
    const site = PRESET_SITES[0];
    const url = horizonsVerifyUrl(site, "2026-06-15", "sun");

    expect(url).toContain("ssd.jpl.nasa.gov");
    expect(url).toContain("CENTER=coord%40301");
    expect(url).toContain("QUANTITIES=4");
    expect(url).toContain("COMMAND=10");
  });

  it("computes 24-hour diurnal timeline profile", async () => {
    const site = PRESET_SITES[0];
    const timeline = await calculateDiurnalTimeline(site, "2026-06-15", 12, defaultScenario().constraints);

    expect(timeline.hours.length).toBe(24);
    expect(timeline.sunlitHours).toBeGreaterThanOrEqual(0);
    expect(timeline.sunlitHours).toBeLessThanOrEqual(24);
    expect(timeline.countdownSun).toBeDefined();
    expect(timeline.countdownEarth).toBeDefined();
  });
});
