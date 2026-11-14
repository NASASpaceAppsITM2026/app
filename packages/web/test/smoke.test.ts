import { describe, expect, it } from "vitest";
import { appName } from "../src/index";

describe("web package smoke", () => {
  it("exports the app name", () => {
    expect(appName).toBe("Lunar Landing Site Navigator");
  });
});
