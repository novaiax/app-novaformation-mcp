// Ported from the NovaFormation app (src/lib/statistics.ts) — keep both in sync.
import { eachDayOfInterval, eachWeekOfInterval, startOfWeek, subDays, subWeeks } from "date-fns";
import { toDateKey } from "./date.js";

export interface BucketPoint {
  key: string;
  value: number;
}

/** Generic daily histogram: fills every day in the trailing window with 0, then sums matching items into it. */
export function bucketByDay<T>(
  items: T[],
  getDateKey: (item: T) => string,
  getValue: (item: T) => number,
  days: number,
  referenceDate: Date = new Date(),
): BucketPoint[] {
  const end = referenceDate;
  const start = subDays(end, Math.max(0, days - 1));

  const buckets = new Map<string, number>();
  for (const day of eachDayOfInterval({ start, end })) {
    buckets.set(toDateKey(day), 0);
  }

  for (const item of items) {
    const key = getDateKey(item);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + getValue(item));
    }
  }

  return Array.from(buckets.entries()).map(([key, value]) => ({ key, value }));
}

/** Same idea, bucketed by the Monday (or configured start) of each trailing week. */
export function bucketByWeek<T>(
  items: T[],
  getDateKey: (item: T) => string,
  getValue: (item: T) => number,
  weeks: number,
  referenceDate: Date = new Date(),
  weekStartsOn: 0 | 1 = 1,
): BucketPoint[] {
  const end = referenceDate;
  const start = subWeeks(end, Math.max(0, weeks - 1));

  const buckets = new Map<string, number>();
  for (const weekStart of eachWeekOfInterval({ start, end }, { weekStartsOn })) {
    buckets.set(toDateKey(weekStart), 0);
  }

  for (const item of items) {
    const itemDate = new Date(getDateKey(item));
    if (Number.isNaN(itemDate.getTime())) continue;
    const weekKey = toDateKey(startOfWeek(itemDate, { weekStartsOn }));
    if (buckets.has(weekKey)) {
      buckets.set(weekKey, (buckets.get(weekKey) ?? 0) + getValue(item));
    }
  }

  return Array.from(buckets.entries()).map(([key, value]) => ({ key, value }));
}
