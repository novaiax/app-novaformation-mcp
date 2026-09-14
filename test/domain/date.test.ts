// Ported from the NovaFormation app (src/lib/date.test.ts) — keep both in sync.
import { describe, expect, it } from "vitest";
import { formatDuration } from "../../src/domain/date.js";

describe("formatDuration", () => {
  it("splits minutes into hours and minutes", () => {
    expect(formatDuration(1055)).toBe("17 h 35 min");
  });

  it("drops the unit that is zero", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(0)).toBe("0 min");
  });

  it("rounds fractional minutes and clamps negatives", () => {
    expect(formatDuration(59.6)).toBe("1 h");
    expect(formatDuration(-5)).toBe("0 min");
  });
});
