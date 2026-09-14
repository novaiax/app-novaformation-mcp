// Ported from the NovaFormation app (src/lib/exercises.test.ts) — keep both in sync.
import { describe, expect, it } from "vitest";
import {
  computeExerciseGoalProgress,
  detectGoalCrossings,
  getExerciseStats,
  groupExerciseStats,
  normalizeExerciseGoalDrafts,
  pickNextGoal,
  type ExerciseGoalInput,
} from "../../src/domain/exercises.js";

describe("groupExerciseStats", () => {
  it("returns an empty map for no logs", () => {
    expect(groupExerciseStats([]).size).toBe(0);
  });

  it("aggregates count, total duration and average score per exercise", () => {
    const logs = [
      { exercise_id: "a", duration_minutes: 10, score: 80 },
      { exercise_id: "a", duration_minutes: 20, score: 90 },
      { exercise_id: "b", duration_minutes: 5, score: null },
    ];
    const stats = groupExerciseStats(logs);
    expect(stats.get("a")).toEqual({ count: 2, totalMinutes: 30, avgScore: 85 });
    expect(stats.get("b")).toEqual({ count: 1, totalMinutes: 5, avgScore: null });
  });

  it("ignores null scores when averaging instead of treating them as 0", () => {
    const logs = [
      { exercise_id: "a", duration_minutes: 10, score: 100 },
      { exercise_id: "a", duration_minutes: 10, score: null },
    ];
    expect(groupExerciseStats(logs).get("a")?.avgScore).toBe(100);
  });

  it("sums correctly even though Postgres returns `numeric` columns as strings", () => {
    // PostgREST serializes `numeric`/`decimal` columns as JSON strings to avoid float
    // precision loss, so `score` is a string at runtime despite the `number | null` type.
    // A naive `sum + score` would string-concatenate ("0" + "7" -> "07") instead of adding.
    const logs = [
      { exercise_id: "a", duration_minutes: 10, score: "7" as unknown as number },
      { exercise_id: "a", duration_minutes: 10, score: "8" as unknown as number },
      { exercise_id: "a", duration_minutes: 10, score: "10" as unknown as number },
    ];
    expect(groupExerciseStats(logs).get("a")?.avgScore).toBe(8.3);
  });
});

describe("getExerciseStats", () => {
  it("returns zeroed stats for an exercise with no logs instead of undefined", () => {
    const stats = getExerciseStats(new Map(), "missing");
    expect(stats).toEqual({ count: 0, totalMinutes: 0, avgScore: null });
  });
});


describe("computeExerciseGoalProgress", () => {
  const reference = new Date("2026-09-16T12:00:00"); // a Wednesday
  const goal = (overrides: Partial<ExerciseGoalInput>): ExerciseGoalInput => ({
    id: "g",
    type: "sessions",
    target: 1,
    period: "total",
    deadline: null,
    ...overrides,
  });
  const logs = [
    { duration_minutes: 30, score: 6, completed_at: "2026-01-01T10:00:00" },
    { duration_minutes: 45, score: 7, completed_at: "2026-09-15T10:00:00" },
  ];

  it("counts all-time sessions", () => {
    expect(computeExerciseGoalProgress(goal({ target: 4 }), logs, reference)).toMatchObject({
      current: 2,
      progress: 0.5,
      reached: false,
    });
  });

  it("sums minutes and caps progress at 1 once reached", () => {
    expect(computeExerciseGoalProgress(goal({ type: "minutes", target: 60 }), logs, reference)).toMatchObject({
      current: 75,
      progress: 1,
      reached: true,
    });
  });

  it("averages scores, coercing numeric strings from Postgres", () => {
    const result = computeExerciseGoalProgress(
      goal({ type: "score", target: "6" as unknown as number }),
      logs.map((log) => ({ ...log, score: String(log.score) as unknown as number })),
      reference,
    );
    expect(result).toMatchObject({ current: 6.5, target: 6, reached: true, sampleSize: 2 });
  });

  it("does not reach a score objective without any scored session", () => {
    const result = computeExerciseGoalProgress(
      goal({ type: "score", target: 5 }),
      [{ duration_minutes: 10, score: null, completed_at: "2026-09-15T10:00:00" }],
      reference,
    );
    expect(result).toMatchObject({ current: 0, reached: false, sampleSize: 0 });
  });

  it("only counts the current week for a weekly objective", () => {
    const weekLogs = [
      { duration_minutes: 20, score: null, completed_at: "2026-09-13T10:00:00" }, // previous Sunday
      { duration_minutes: 20, score: null, completed_at: "2026-09-14T08:00:00" }, // Monday
      { duration_minutes: 20, score: null, completed_at: "2026-09-16T08:00:00" },
    ];
    const result = computeExerciseGoalProgress(goal({ period: "week", target: 2 }), weekLogs, reference);
    expect(result).toMatchObject({ periodStart: "2026-09-14", current: 2, reached: true });
  });

  it("reports days left until the deadline", () => {
    expect(computeExerciseGoalProgress(goal({ deadline: "2026-09-30" }), [], reference).daysLeft).toBe(14);
  });
});

describe("normalizeExerciseGoalDrafts", () => {
  it("keeps valid rows and defaults period and deadline", () => {
    expect(
      normalizeExerciseGoalDrafts([
        { type: "minutes", target: "600" },
        {
          id: "0b7f2a8e-3c1d-4e5f-9a6b-7c8d9e0f1a2b",
          type: "score",
          target: 7.5,
          period: "week",
          deadline: "2026-12-31",
        },
      ]),
    ).toEqual([
      { type: "minutes", target: 600, period: "total", deadline: null },
      {
        id: "0b7f2a8e-3c1d-4e5f-9a6b-7c8d9e0f1a2b",
        type: "score",
        target: 7.5,
        period: "week",
        deadline: "2026-12-31",
      },
    ]);
  });

  it("drops rows with an unknown type or a missing/non-positive target", () => {
    expect(
      normalizeExerciseGoalDrafts([
        { type: "calories", target: 10 },
        { type: "sessions", target: 0 },
        { type: "sessions", target: "" },
        null,
      ]),
    ).toEqual([]);
    expect(normalizeExerciseGoalDrafts("not an array")).toEqual([]);
  });

  it("discards malformed ids, periods and dates instead of rejecting the row", () => {
    expect(
      normalizeExerciseGoalDrafts([{ id: "x", type: "sessions", target: 3, period: "year", deadline: "soon" }]),
    ).toEqual([{ type: "sessions", target: 3, period: "total", deadline: null }]);
  });
});

describe("goal status and remaining", () => {
  const reference = new Date("2026-09-16T12:00:00");
  const minutesGoal = { id: "m", type: "minutes" as const, target: 1000, period: "total" as const, deadline: null };
  const log = (minutes: number) => ({ duration_minutes: minutes, score: null, completed_at: "2026-09-10T10:00:00" });

  it("is in progress below the near threshold, with the remaining quantity", () => {
    expect(computeExerciseGoalProgress(minutesGoal, [log(500)], reference)).toMatchObject({
      status: "in_progress",
      remaining: 500,
    });
  });

  it("is near from 80% of the target", () => {
    expect(computeExerciseGoalProgress(minutesGoal, [log(800)], reference)).toMatchObject({
      status: "near",
      remaining: 200,
    });
  });

  it("is reached with nothing remaining once the target is met", () => {
    expect(computeExerciseGoalProgress(minutesGoal, [log(1055)], reference)).toMatchObject({
      status: "reached",
      remaining: 0,
      periodKey: "total",
    });
  });
});

describe("pickNextGoal", () => {
  const reference = new Date("2026-09-16T12:00:00");
  const logs = [{ duration_minutes: 90, score: null, completed_at: "2026-09-10T10:00:00" }];
  const goal = (id: string, type: "sessions" | "minutes", target: number, deadline: string | null = null) =>
    computeExerciseGoalProgress({ id, type, target, period: "total", deadline }, logs, reference);

  it("returns the unreached objective closest to completion", () => {
    const next = pickNextGoal([goal("far", "minutes", 900), goal("close", "minutes", 100), goal("done", "sessions", 1)]);
    expect(next?.id).toBe("close");
  });

  it("breaks ties with the earliest deadline", () => {
    const next = pickNextGoal([goal("late", "minutes", 180, "2026-12-01"), goal("soon", "minutes", 180, "2026-10-01")]);
    expect(next?.id).toBe("soon");
  });

  it("returns null when every objective is reached", () => {
    expect(pickNextGoal([goal("done", "sessions", 1)])).toBeNull();
  });
});

describe("detectGoalCrossings", () => {
  const reference = new Date("2026-09-16T12:00:00");
  const at = (minutes: number, score: number | null = null) => ({
    duration_minutes: minutes,
    score,
    completed_at: "2026-09-15T10:00:00",
  });
  const goals = [
    { id: "m1000", type: "minutes" as const, target: 1000, period: "total" as const, deadline: null },
    { id: "m2000", type: "minutes" as const, target: 2000, period: "total" as const, deadline: null },
    { id: "s20", type: "sessions" as const, target: 20, period: "total" as const, deadline: null },
  ];

  it("detects old total < target <= new total (995 min + 60 min crosses 1000)", () => {
    const before = [at(995)];
    const crossings = detectGoalCrossings(goals, before, [...before, at(60)], reference);
    expect(crossings).toEqual([{ goal: goals[0], periodKey: "total", before: 995, after: 1055 }]);
  });

  it("counts landing exactly on the target as a crossing", () => {
    const before = [at(940)];
    expect(detectGoalCrossings(goals, before, [...before, at(60)], reference).map((c) => c.goal.id)).toEqual([
      "m1000",
    ]);
  });

  it("never re-crosses an objective that was already reached before the session", () => {
    const before = [at(1055)];
    expect(detectGoalCrossings(goals, before, [...before, at(60)], reference)).toEqual([]);
  });

  it("returns every objective one session crosses, so they can be celebrated together", () => {
    const before = Array.from({ length: 19 }, () => at(50)); // 950 min over 19 sessions
    const crossed = detectGoalCrossings(goals, before, [...before, at(60)], reference);
    expect(crossed.map((c) => c.goal.id)).toEqual(["m1000", "s20"]);
  });

  it("crosses a score objective when the new average reaches it", () => {
    const scoreGoal = [{ id: "avg", type: "score" as const, target: 7, period: "total" as const, deadline: null }];
    const before = [at(10, 6)];
    expect(detectGoalCrossings(scoreGoal, before, [...before, at(10, 8)], reference)).toMatchObject([
      { before: 6, after: 7 },
    ]);
  });
});
