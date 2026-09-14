// Ported from the NovaFormation app (src/lib/supabase/errors.ts) — keep both in sync.
/** True when a query hit a table that doesn't exist yet (a migration not applied). */
export function isMissingTableError(error: { code?: string } | null | undefined) {
  // 42P01: undefined_table (Postgres) · PGRST205: table not in PostgREST's schema cache
  return error?.code === "42P01" || error?.code === "PGRST205";
}
