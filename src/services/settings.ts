// Ported from the NovaFormation app (src/lib/queries/settings.ts) — keep both in sync.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../domain/database.js";
import { DEFAULT_LEVEL_CURVE } from "../domain/xp.js";

const FALLBACK_SETTINGS: Omit<Database["public"]["Tables"]["settings"]["Row"], "user_id"> = {
  default_task_xp: 10,
  default_habit_xp: 15,
  default_exercise_xp: 20,
  book_completion_xp: 50,
  level_base_xp: DEFAULT_LEVEL_CURVE.base,
  level_growth: DEFAULT_LEVEL_CURVE.growth,
  week_starts_on: 1,
  updated_at: new Date().toISOString(),
};

export async function getSettings(supabase: SupabaseClient<Database>, userId: string) {
  const { data } = await supabase.from("settings").select("*").eq("user_id", userId).single();
  return data ?? { user_id: userId, ...FALLBACK_SETTINGS };
}

export function weekStartsOn(settings: { week_starts_on: number }): 0 | 1 {
  return settings.week_starts_on === 0 ? 0 : 1;
}
