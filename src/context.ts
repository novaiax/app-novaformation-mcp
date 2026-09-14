import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./domain/database.js";
import type { Config } from "./config.js";
import { ToolError } from "./tools/result.js";

export interface ToolContext {
  supabase: SupabaseClient<Database>;
  userId: string;
}

/**
 * Tools read and write with the Supabase service-role key, which bypasses row-level
 * security: every query MUST stay scoped to `userId` — directly, or through an
 * ownership check from tools/ownership.ts for rows that carry no user_id.
 */
export function createContextProvider(config: Config): () => Promise<ToolContext> {
  let supabase: SupabaseClient<Database> | null = null;
  let userId: string | null = config.userId ?? null;

  return async () => {
    if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
      throw new ToolError("unavailable", "Server not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    }
    supabase ??= createClient<Database>(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (!userId) {
      // NovaFormation is single-user by design: use its one account unless told otherwise.
      const { data, error } = await supabase.from("profiles").select("id").limit(2);
      if (error) throw error;
      if (data.length === 0) throw new ToolError("unavailable", "No NovaFormation account exists yet.");
      if (data.length > 1) {
        throw new ToolError("unavailable", "Several accounts exist: set NOVAFORMATION_USER_ID to pick one.");
      }
      userId = data[0].id;
    }

    return { supabase, userId };
  };
}
