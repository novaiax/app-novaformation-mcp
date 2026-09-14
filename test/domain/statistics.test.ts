// Ported from the NovaFormation app (src/lib/statistics.test.ts) — keep both in sync.
import { describe, expect, it } from "vitest";
import { bucketByDay, bucketByWeek } from "../../src/domain/statistics.js";

describe("bucketByDay", () => {
  it("fills every day in the window with 0 when there is no data", () => {
    const result = bucketByDay([], (i: never) => i, () => 0, 3, new Date("2026-06-15"));
    expect(result).toEqual([
      { key: "2026-06-13", value: 0 },
      { key: "2026-06-14", value: 0 },
      { key: "2026-06-15", value: 0 },
    ]);
  });

  it("sums values that share the same day key", () => {
    const items = [
      { date: "2026-06-14", amount: 10 },
      { date: "2026-06-14", amount: 5 },
      { date: "2026-06-15", amount: 3 },
    ];
    const result = bucketByDay(
      items,
      (i) => i.date,
      (i) => i.amount,
      3,
      new Date("2026-06-15"),
    );
    expect(result).toEqual([
      { key: "2026-06-13", value: 0 },
      { key: "2026-06-14", value: 15 },
      { key: "2026-06-15", value: 3 },
    ]);
  });

  it("ignores items outside the trailing window", () => {
    const items = [{ date: "2026-05-01", amount: 100 }];
    const result = bucketByDay(
      items,
      (i) => i.date,
      (i) => i.amount,
      3,
      new Date("2026-06-15"),
    );
    expect(result.every((point) => point.value === 0)).toBe(true);
  });
});

describe("bucketByWeek", () => {
  it("groups items into the Monday-starting week bucket", () => {
    // 2026-06-15 is a Monday; 2026-06-18 falls in the same ISO week.
    const items = [
      { date: "2026-06-15", value: 2 },
      { date: "2026-06-18", value: 4 },
    ];
    const result = bucketByWeek(
      items,
      (i) => i.date,
      (i) => i.value,
      1,
      new Date("2026-06-18"),
      1,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ key: "2026-06-15", value: 6 });
  });

  it("skips unparseable date keys instead of throwing", () => {
    const items = [{ date: "not-a-date", value: 5 }];
    expect(() =>
      bucketByWeek(
        items,
        (i) => i.date,
        (i) => i.value,
        2,
        new Date("2026-06-18"),
      ),
    ).not.toThrow();
  });
});
