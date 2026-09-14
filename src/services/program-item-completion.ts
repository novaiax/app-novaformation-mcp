// Ported from the NovaFormation app (src/lib/program-item-completion.ts) — keep both in sync.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../domain/database.js";
import { awardXp, revokeXp } from "./xp-award.js";

/**
 * Single source of truth for "was this module item done" — the module item
 * itself is canonical; a Today task row (if any) just mirrors its state, so
 * XP is only ever granted once regardless of which page triggered it.
 */
export async function setModuleItemCompletion(
  supabase: SupabaseClient<Database>,
  userId: string,
  itemId: string,
  completed: boolean,
  xpValue: number,
) {
  const completedAt = completed ? new Date().toISOString() : null;

  const { error } = await supabase
    .from("module_items")
    .update({ is_completed: completed, completed_at: completedAt })
    .eq("id", itemId);
  if (error) throw error;

  const { error: taskSyncError } = await supabase
    .from("tasks")
    .update({ is_completed: completed, completed_at: completedAt })
    .eq("program_item_id", itemId);
  if (taskSyncError) throw taskSyncError;

  if (completed) {
    await awardXp(supabase, userId, "task", itemId, xpValue);
  } else {
    await revokeXp(supabase, userId, "task", itemId);
  }
}
