// Ported from the NovaFormation app (src/lib/exercise-achievements.ts) — keep both in sync.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../domain/database.js";
import { detectGoalCrossings } from "../domain/exercises.js";
import { getSettings } from "./settings.js";
import { isMissingTableError } from "./errors.js";

/**
 * Call right after a session is logged. Stores one achievement per objective the
 * session pushed over its target and returns ONLY the rows inserted by this call:
 * the unique key on (goal_id, type, target, period_key) turns a replay, a refresh
 * or a later session into a no-op, so a milestone is returned — and celebrated —
 * exactly once.
 */
export async function recordGoalAchievements(
  supabase: SupabaseClient<Database>,
  userId: string,
  exerciseId: string,
  logId: string,
): Promise<Tables<"exercise_goal_achievements">[]> {
  const { data: goals, error: goalsError } = await supabase
    .from("exercise_goals")
    .select("id, type, target, period, deadline")
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId);
  if (goalsError) {
    if (isMissingTableError(goalsError)) return [];
    throw goalsError;
  }
  if (goals.length === 0) return [];

  const [{ data: logs, error: logsError }, settings] = await Promise.all([
    supabase
      .from("exercise_logs")
      .select("id, duration_minutes, score, completed_at")
      .eq("user_id", userId)
      .eq("exercise_id", exerciseId),
    getSettings(supabase, userId),
  ]);
  if (logsError) throw logsError;

  const crossings = detectGoalCrossings(
    goals,
    logs.filter((log) => log.id !== logId),
    logs,
    new Date(),
    settings.week_starts_on === 0 ? 0 : 1,
  );
  if (crossings.length === 0) return [];

  const { data: inserted, error } = await supabase
    .from("exercise_goal_achievements")
    .upsert(
      crossings.map((crossing) => ({
        user_id: userId,
        exercise_id: exerciseId,
        goal_id: crossing.goal.id,
        log_id: logId,
        type: crossing.goal.type,
        target: Number(crossing.goal.target),
        period: crossing.goal.period,
        period_key: crossing.periodKey,
        value_before: crossing.before,
        value_after: crossing.after,
      })),
      { onConflict: "goal_id,type,target,period_key", ignoreDuplicates: true },
    )
    .select();
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return inserted;
}
