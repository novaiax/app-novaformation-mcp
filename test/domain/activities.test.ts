import { describe, expect, it } from "vitest";
import { activityPeriodSeries, activityTimeBreakdowns, computeActivityStats,
  type ActivityData } from "../../src/domain/activities.js";
import type { Tables } from "../../src/domain/database.js";

const activity = {
  id: "a", name: "Impro", goal_type: "sessions", goal_target: 4,
  category_id: "c",
} as Tables<"activities">;
const session = (id: string, status: Tables<"activity_sessions">["status"], date: string,
  actualMinutes: number | null = null) => ({
  id, activity_id: "a", session_date: date, start_time: "19:00", sort_order: 0,
  planned_minutes: 120, actual_minutes: actualMinutes, status,
}) as Tables<"activity_sessions">;

describe("activity statistics", () => {
  it("shows past planned sessions for validation without counting them as missed", () => {
    const rows = [session("past", "planned", "2026-09-01"), session("future", "planned", "2026-10-01")];
    expect(computeActivityStats(activity, rows, "2026-09-29")).toMatchObject({
      needsReview: 1, remaining: 1, done: 0, missed: 0, attendanceRate: null,
    });
  });

  it("excludes organizer cancellations and postponed sessions from attendance", () => {
    const rows = [
      session("1", "done", "2026-09-01", 100),
      session("2", "done", "2026-09-08", 120),
      session("3", "missed", "2026-09-15"),
      session("4", "cancelled_organizer", "2026-09-22"),
      session("5", "postponed", "2026-09-29"),
      session("6", "planned", "2026-10-06"),
    ];
    expect(computeActivityStats(activity, rows, "2026-09-29")).toMatchObject({
      scheduled: 4, done: 2, missed: 1, cancelledOrganizer: 1,
      postponed: 1, remaining: 1, actualMinutes: 220,
      attendanceRate: 2 / 3, progress: 0.5,
      nextSession: { id: "6" },
    });
  });

  it("counts actual session duration under every linked skill and program", () => {
    const rows = [session("1", "done", "2026-09-01", 60), session("2", "done", "2026-09-08", 90)];
    const data = {
      activities: [activity], sessions: rows, rules: [],
      skills: [{ id: "s1", name: "Éloquence" }, { id: "s2", name: "Écoute" }],
      categories: [{ id: "c", name: "Scène" }], programs: [{ id: "p", title: "Éloquence" }],
      activitySkills: [{ activity_id: "a", skill_id: "s1" }, { activity_id: "a", skill_id: "s2" }],
      activityPrograms: [{ activity_id: "a", program_id: "p" }],
      sessionSkills: [{ session_id: "2", skill_id: "s2" }],
    } as unknown as ActivityData;
    const result = activityTimeBreakdowns(data, rows);
    expect(result.activity[0].minutes).toBe(150);
    expect(result.category[0].minutes).toBe(150);
    expect(result.program[0].minutes).toBe(150);
    expect(result.skill.find((row) => row.id === "s1")?.minutes).toBe(60);
    expect(result.skill.find((row) => row.id === "s2")?.minutes).toBe(150);
  });

  it("does not reassign completed time when a skill was linked after the session", () => {
    const row = { ...session("past", "done", "2026-09-01", 60), skill_snapshot_complete: true };
    const data = {
      activities: [activity], sessions: [row], rules: [], skills: [{ id: "s1", name: "New skill" }],
      categories: [], programs: [], activitySkills: [{ activity_id: "a", skill_id: "s1" }],
      activityPrograms: [], sessionSkills: [], suppressed: [],
    } as unknown as ActivityData;
    expect(activityTimeBreakdowns(data, [row]).skill).toEqual([]);
  });

  it("buckets realized sessions by calendar week and month", () => {
    const rows = [session("1", "done", "2026-09-29", 60), session("2", "done", "2026-10-01", 90)];
    expect(activityPeriodSeries(rows, "week")).toEqual([{ key: "2026-09-28", sessions: 2, minutes: 150 }]);
    expect(activityPeriodSeries(rows, "month")).toEqual([
      { key: "2026-09", sessions: 1, minutes: 60 },
      { key: "2026-10", sessions: 1, minutes: 90 },
    ]);
  });
});
