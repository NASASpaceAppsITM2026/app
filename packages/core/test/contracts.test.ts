import { describe, expect, it } from "vitest";
import {
  NotImplementedError,
  evaluateConstraints,
  horizonMaskFor,
  skyAt,
  slipWindowFinder,
  sunlitAndEarthVisibleWindows,
  visibleDiscFraction,
} from "../src/contracts";

describe("science core contracts", () => {
  it("fails loudly via NotImplementedError for scaffolded engine entry points", () => {
    expect(() => skyAt({ id: "synthetic", eastLonDeg: 0, latDeg: -89.5 }, 0)).toThrow(NotImplementedError);
    expect(() => horizonMaskFor({ id: "synthetic", eastLonDeg: 0, latDeg: -89.5 }, 0)).toThrow(NotImplementedError);
    expect(() => visibleDiscFraction({ id: "synthetic", eastLonDeg: 0, latDeg: -89.5 }, 0)).toThrow(NotImplementedError);
    expect(() =>
      sunlitAndEarthVisibleWindows({ id: "synthetic", eastLonDeg: 0, latDeg: -89.5 }, 0),
    ).toThrow(NotImplementedError);
    expect(() =>
      evaluateConstraints([], { skyState: { epochTdbSec: 0, sunAzimuthDeg: 0, sunElevationDeg: 0, earthAzimuthDeg: 0, earthElevationDeg: 0 } }),
    ).toThrow(NotImplementedError);
    expect(() =>
      slipWindowFinder({
        site: { id: "synthetic", eastLonDeg: 0, latDeg: -89.5 },
        dateUtc: "2026-11-13T00:00:00Z",
        constraints: [],
        dateRangeDays: 30,
      }),
    ).toThrow(NotImplementedError);
  });
});
