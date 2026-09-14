// Ported from the NovaFormation app (src/lib/xp.test.ts) — keep both in sync.
import { describe, expect, it } from "vitest";
import { getLevelInfo, type LevelCurve } from "../../src/domain/xp.js";

const curve: LevelCurve = { base: 100, growth: 1.5 };

describe("getLevelInfo", () => {
  it("starts at level 1 with zero xp", () => {
    const info = getLevelInfo(0, curve);
    expect(info.level).toBe(1);
    expect(info.currentLevelXp).toBe(0);
    expect(info.progress).toBe(0);
  });

  it("clamps negative xp to zero instead of throwing or going negative", () => {
    const info = getLevelInfo(-500, curve);
    expect(info.level).toBe(1);
    expect(info.currentLevelXp).toBe(0);
  });

  it("advances a level once the threshold is crossed", () => {
    const threshold = Math.round(curve.base * Math.pow(1, curve.growth)); // 100
    const justBelow = getLevelInfo(threshold - 1, curve);
    const exact = getLevelInfo(threshold, curve);
    expect(justBelow.level).toBe(1);
    expect(exact.level).toBe(2);
    expect(exact.currentLevelXp).toBe(0);
  });

  it("computes progress as a 0..1 fraction of the current level", () => {
    const info = getLevelInfo(50, curve); // level 1 needs 100 xp
    expect(info.xpToNextLevel).toBe(100);
    expect(info.progress).toBeCloseTo(0.5);
  });

  it("never loops forever on a degenerate curve (base 0, growth 0)", () => {
    const info = getLevelInfo(10_000, { base: 0, growth: 0 });
    expect(info.level).toBeGreaterThan(1);
    expect(Number.isFinite(info.level)).toBe(true);
  });

  it("handles non-finite input defensively", () => {
    const info = getLevelInfo(Number.NaN, curve);
    expect(info.level).toBe(1);
    expect(info.currentLevelXp).toBe(0);
  });
});
