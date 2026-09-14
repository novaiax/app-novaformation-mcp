import type { ToolContext } from "../context.js";
import { notFound } from "./result.js";

// The service-role client ignores RLS, so every id a caller passes in is resolved
// here against the user before anything is read or written through it. Nested
// program rows (weeks, modules, items) carry no user_id: walk up to the program.

export async function ownedProgram({ supabase, userId }: ToolContext, programId: string) {
  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("id", programId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? notFound(`Program ${programId}`);
}

export async function ownedWeek(ctx: ToolContext, weekId: string) {
  const { data, error } = await ctx.supabase.from("program_weeks").select("*").eq("id", weekId).maybeSingle();
  if (error) throw error;
  if (!data) return notFound(`Week ${weekId}`);
  await ownedProgram(ctx, data.program_id).catch(() => notFound(`Week ${weekId}`));
  return data;
}

export async function ownedModule(ctx: ToolContext, moduleId: string) {
  const { data, error } = await ctx.supabase.from("program_modules").select("*").eq("id", moduleId).maybeSingle();
  if (error) throw error;
  if (!data) return notFound(`Module ${moduleId}`);
  const week = await ownedWeek(ctx, data.week_id).catch(() => notFound(`Module ${moduleId}`));
  return { module: data, programId: week.program_id };
}

export async function ownedModuleItem(ctx: ToolContext, itemId: string) {
  const { data, error } = await ctx.supabase.from("module_items").select("*").eq("id", itemId).maybeSingle();
  if (error) throw error;
  if (!data) return notFound(`Module item ${itemId}`);
  const { programId } = await ownedModule(ctx, data.module_id).catch(() => notFound(`Module item ${itemId}`));
  return { item: data, programId };
}

export async function ownedBook({ supabase, userId }: ToolContext, bookId: string) {
  const { data, error } = await supabase.from("books").select("*").eq("id", bookId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ?? notFound(`Book ${bookId}`);
}

export async function ownedExercise({ supabase, userId }: ToolContext, exerciseId: string) {
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .eq("id", exerciseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? notFound(`Exercise ${exerciseId}`);
}

export async function ownedExerciseLog({ supabase, userId }: ToolContext, logId: string) {
  const { data, error } = await supabase
    .from("exercise_logs")
    .select("*")
    .eq("id", logId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? notFound(`Exercise session ${logId}`);
}

export async function ownedExerciseGoal({ supabase, userId }: ToolContext, goalId: string) {
  const { data, error } = await supabase
    .from("exercise_goals")
    .select("*")
    .eq("id", goalId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? notFound(`Objective ${goalId}`);
}

export async function ownedCategory({ supabase, userId }: ToolContext, categoryId: string) {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("id", categoryId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? notFound(`Category ${categoryId}`);
}

/** `undefined` = leave unchanged, `null` = clear, a uuid = must be one of the user's categories. */
export async function resolveCategoryId(ctx: ToolContext, categoryId: string | null | undefined) {
  if (categoryId === undefined || categoryId === null) return categoryId;
  await ownedCategory(ctx, categoryId);
  return categoryId;
}
