import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/domain/database.js";
import { recordGoalAchievements } from "../../src/services/exercise-achievements.js";

describe("recordGoalAchievements", () => {
  it("returns the milestone inserted by the database trigger for the new session", async () => {
    const milestone = { id: "milestone-1", log_id: "log-1" };
    const filters: [string, string][] = [];
    const query = {
      select: () => query,
      eq(column: string, value: string) {
        filters.push([column, value]);
        return filters.length === 3 ? Promise.resolve({ data: [milestone], error: null }) : query;
      },
    };
    const supabase = {
      from(table: string) {
        expect(table).toBe("exercise_goal_achievements");
        return query;
      },
    } as unknown as SupabaseClient<Database>;

    const result = await recordGoalAchievements(supabase, "user-1", "exercise-1", "log-1");

    expect(result).toEqual([milestone]);
    expect(filters).toEqual([
      ["user_id", "user-1"],
      ["exercise_id", "exercise-1"],
      ["log_id", "log-1"],
    ]);
  });
});
