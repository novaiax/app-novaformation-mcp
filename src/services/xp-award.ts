// Ported from the NovaFormation app (src/lib/xp-award.ts) — keep both in sync.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, XpSource } from "../domain/database.js";

/** Every completion event (task/habit/exercise/book) funnels through here — sum(xp_events.amount) IS the user's total XP. */
export async function awardXp(
  supabase: SupabaseClient<Database>,
  userId: string,
  source: XpSource,
  refId: string | null,
  amount: number,
) {
  if (amount <= 0) return;
  const { error } = await supabase
    .from("xp_events")
    .insert({ user_id: userId, source, ref_id: refId, amount });
  if (error) throw error;
}

/** Un-completing something removes its XP grant so total XP stays exactly in sync. */
export async function revokeXp(
  supabase: SupabaseClient<Database>,
  userId: string,
  source: XpSource,
  refId: string,
) {
  const { error } = await supabase
    .from("xp_events")
    .delete()
    .eq("user_id", userId)
    .eq("source", source)
    .eq("ref_id", refId);
  if (error) throw error;
}
