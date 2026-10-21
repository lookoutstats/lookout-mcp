import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rangeLabel, RangeSchema, toRangeKey } from "../src/range.js";
import { VERSION } from "../src/version.js";

const NOW = new Date("2026-10-21T12:00:00Z");

describe("range", () => {
  it("takes the presets as they are and defaults to 7d", () => {
    expect(toRangeKey("24h", NOW)).toBe("24h");
    expect(toRangeKey(RangeSchema.parse(undefined), NOW)).toBe("7d");
  });

  it("turns a custom window into the API's from..to key, within its limits", () => {
    expect(toRangeKey({ from: "2026-10-01", to: "2026-10-21" }, NOW)).toBe("2026-10-01..2026-10-21");
    expect(() => toRangeKey({ from: "2026-10-10", to: "2026-10-01" }, NOW)).toThrow(/after/);
    expect(() => toRangeKey({ from: "2026-10-20", to: "2026-10-22" }, NOW)).toThrow(/future/);
    expect(() => toRangeKey({ from: "2026-09-01", to: "2026-10-21" }, NOW)).toThrow(/at most 30 days/);
    expect(RangeSchema.safeParse({ from: "Oct 1", to: "2026-10-02" }).success).toBe(false);
    expect(RangeSchema.safeParse("1y").success).toBe(false);
  });

  it("labels ranges for the summaries", () => {
    expect(rangeLabel("30d")).toBe("last 30 days");
    expect(rangeLabel("2026-10-01..2026-10-14")).toBe("Oct 1 – Oct 14");
  });

  it("keeps VERSION in step with package.json", () => {
    expect(VERSION).toBe(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  });
});
