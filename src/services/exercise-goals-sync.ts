// Ported from the NovaFormation app (src/lib/exercise-goals-sync.ts) — keep both in sync.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../domain/database.js";
import type { ExerciseGoalDraft } from "../domain/exercises.js";
import { isMissingTableError } from "./errors.js";

/**
 * Makes an exercise's objectives exactly `drafts`, in order: rows with a known
 * id are updated, new rows inserted, and objectives missing from the list deleted.
 */
export async function replaceExerciseGoals(
  supabase: SupabaseClient<Database>,
  userId: string,
  exerciseId: string,
  drafts: ExerciseGoalDraft[],
) {
  const { data: existing, error: fetchError } = await supabase
    .from("exercise_goals")
    .select("id")
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId);
  if (fetchError) {
    // Nothing to store and nowhere to store it: saving an exercise must not fail before migration 0004.
    if (isMissingTableError(fetchError) && drafts.length === 0) return;
    if (isMissingTableError(fetchError)) {
      throw new Error("Objectives need the exercise_goals table — apply supabase/migrations/0004_exercise_goals.sql.");
    }
    throw fetchError;
  }

  const existingIds = new Set(existing.map((goal) => goal.id));
  const keptIds = new Set(drafts.flatMap((draft) => (draft.id && existingIds.has(draft.id) ? [draft.id] : [])));
  const removedIds = [...existingIds].filter((id) => !keptIds.has(id));

  if (removedIds.length > 0) {
    const { error } = await supabase
      .from("exercise_goals")
      .delete()
      .eq("user_id", userId)
      .in("id", removedIds);
    if (error) throw error;
  }

  const inserts: Database["public"]["Tables"]["exercise_goals"]["Insert"][] = [];

  for (const [index, draft] of drafts.entries()) {
    const fields = {
      type: draft.type,
      target: draft.target,
      period: draft.period,
      deadline: draft.deadline,
      sort_order: index,
    };

    if (draft.id && keptIds.has(draft.id)) {
      const { error } = await supabase
        .from("exercise_goals")
        .update(fields)
        .eq("user_id", userId)
        .eq("id", draft.id);
      if (error) throw error;
    } else {
      inserts.push({ ...fields, user_id: userId, exercise_id: exerciseId });
    }
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from("exercise_goals").insert(inserts);
    if (error) throw error;
  }
}
