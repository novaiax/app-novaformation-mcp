import { z } from "zod";
import { color, confirm, defineTool, definedOnly, icon, id, throwIf } from "./define.js";
import { ownedCategory } from "./ownership.js";
import { badRequest } from "./result.js";
import { getSettings } from "../services/settings.js";

// Every table with a category_id — merging categories must reassign all of them (same list as the app).
const CATEGORY_REFERENCING_TABLES = ["books", "exercises", "habits", "tasks", "task_templates"] as const;

export const settingsTools = [
  defineTool({
    name: "get_settings",
    title: "Get settings",
    description:
      "Profil (nom affiche) et reglages : XP par session d'exercice par defaut, XP de fin de livre, courbe de niveau " +
      "(base et croissance), premier jour de la semaine.",
    kind: "read",
    input: {},
    handler: async (_args, { supabase, userId }) => {
      const [settings, profile] = await Promise.all([
        getSettings(supabase, userId),
        supabase.from("profiles").select("display_name, created_at").eq("id", userId).maybeSingle(),
      ]);
      throwIf(profile.error);
      const curve = { base: settings.level_base_xp, growth: Number(settings.level_growth) };
      return {
        profile: profile.data,
        settings: {
          default_exercise_xp: settings.default_exercise_xp,
          book_completion_xp: settings.book_completion_xp,
          level_base_xp: settings.level_base_xp,
          level_growth: Number(settings.level_growth),
          week_starts_on: settings.week_starts_on === 0 ? "sunday" : "monday",
          updated_at: settings.updated_at,
        },
        // Same curve as the app: going from level L to L+1 costs round(base * L^growth) XP.
        xp_to_go_from_level: [1, 2, 3, 5, 10].map((level) => ({
          level,
          xp: Math.max(1, Math.round(curve.base * Math.pow(level, curve.growth))),
        })),
      };
    },
  }),

  defineTool({
    name: "update_settings",
    title: "Update settings",
    description: "Modifie les reglages (seuls les champs fournis changent).",
    kind: "write",
    input: {
      default_exercise_xp: z.number().int().min(0).max(100000).optional(),
      book_completion_xp: z.number().int().min(0).max(100000).optional(),
      level_base_xp: z.number().int().min(1).max(100000).optional(),
      level_growth: z.number().min(0.1).max(5).optional(),
      week_starts_on: z.enum(["sunday", "monday"]).optional(),
    },
    handler: async ({ week_starts_on, ...values }, { supabase, userId }) => {
      const update = definedOnly({
        ...values,
        week_starts_on: week_starts_on === undefined ? undefined : week_starts_on === "sunday" ? 0 : 1,
      });
      if (Object.keys(update).length === 0) badRequest("Nothing to update");

      const { data, error } = await supabase.from("settings").update(update).eq("user_id", userId).select().single();
      throwIf(error);
      return { updated: data };
    },
  }),

  defineTool({
    name: "update_profile",
    title: "Update profile",
    description: "Change le nom affiche de l'utilisateur.",
    kind: "write",
    input: { display_name: z.string().trim().min(1).max(80) },
    handler: async ({ display_name }, { supabase, userId }) => {
      const { data, error } = await supabase
        .from("profiles")
        .update({ display_name })
        .eq("id", userId)
        .select("display_name")
        .single();
      throwIf(error);
      return { updated: data };
    },
  }),

  defineTool({
    name: "list_categories",
    title: "List categories",
    description: "Categories (nom, icone, couleur, ordre) avec le nombre de livres et d'exercices rattaches.",
    kind: "read",
    input: {},
    handler: async (_args, { supabase, userId }) => {
      const [categories, books, exercises] = await Promise.all([
        supabase.from("categories").select("*").eq("user_id", userId).order("sort_order", { ascending: true }),
        supabase.from("books").select("category_id").eq("user_id", userId),
        supabase.from("exercises").select("category_id").eq("user_id", userId),
      ]);
      for (const result of [categories, books, exercises]) throwIf(result.error);

      const count = (rows: { category_id: string | null }[] | null, categoryId: string) =>
        (rows ?? []).filter((row) => row.category_id === categoryId).length;

      return (categories.data ?? []).map((category) => ({
        id: category.id,
        name: category.name,
        icon: category.icon,
        color: category.color,
        sort_order: category.sort_order,
        books: count(books.data, category.id),
        exercises: count(exercises.data, category.id),
      }));
    },
  }),

  defineTool({
    name: "create_category",
    title: "Create category",
    description: "Cree une categorie (nom unique).",
    kind: "write",
    input: {
      name: z.string().trim().min(1).max(60),
      icon: icon.optional(),
      color: color.optional(),
    },
    handler: async ({ name, icon: iconName, color: hex }, { supabase, userId }) => {
      const { data: last } = await supabase
        .from("categories")
        .select("sort_order")
        .eq("user_id", userId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data, error } = await supabase
        .from("categories")
        .insert({
          user_id: userId,
          name,
          icon: iconName ?? "Sparkles",
          color: hex ?? "#6366f1",
          sort_order: (last?.sort_order ?? -1) + 1,
        })
        .select()
        .single();
      throwIf(error);
      return { created: data };
    },
  }),

  defineTool({
    name: "update_category",
    title: "Update category",
    description: "Modifie une categorie (seuls les champs fournis changent).",
    kind: "write",
    input: {
      category_id: id("Category"),
      name: z.string().trim().min(1).max(60).optional(),
      icon: icon.optional(),
      color: color.optional(),
      sort_order: z.number().int().min(0).optional(),
    },
    handler: async ({ category_id, ...values }, ctx) => {
      await ownedCategory(ctx, category_id);
      const update = definedOnly(values);
      if (Object.keys(update).length === 0) badRequest("Nothing to update");

      const { data, error } = await ctx.supabase
        .from("categories")
        .update(update)
        .eq("id", category_id)
        .eq("user_id", ctx.userId)
        .select()
        .single();
      throwIf(error);
      return { updated: data };
    },
  }),

  defineTool({
    name: "merge_categories",
    title: "Merge categories",
    description:
      "Fusionne des categories dans une categorie cible : tout ce qui pointait vers les sources (livres, exercices, " +
      "et donnees masquees) est rattache a la cible, puis les sources sont supprimees. Aucune donnee rattachee n'est perdue.",
    kind: "write",
    input: {
      source_category_ids: z.array(id("Category")).min(1),
      target_category_id: id("Category"),
    },
    handler: async ({ source_category_ids, target_category_id }, ctx) => {
      await ownedCategory(ctx, target_category_id);
      const sources = [...new Set(source_category_ids)].filter((sourceId) => sourceId !== target_category_id);
      for (const sourceId of sources) await ownedCategory(ctx, sourceId);
      if (sources.length === 0) return { merged: 0 };

      for (const table of CATEGORY_REFERENCING_TABLES) {
        const { error } = await ctx.supabase
          .from(table)
          .update({ category_id: target_category_id })
          .eq("user_id", ctx.userId)
          .in("category_id", sources);
        throwIf(error);
      }
      const { error } = await ctx.supabase.from("categories").delete().eq("user_id", ctx.userId).in("id", sources);
      throwIf(error);
      return { merged: sources.length, target_category_id };
    },
  }),

  defineTool({
    name: "delete_category",
    title: "Delete category",
    description:
      "Supprime une categorie. Les livres et exercices rattaches sont conserves (ils deviennent sans categorie). " +
      "Preferer merge_categories pour les regrouper.",
    kind: "delete",
    input: { category_id: id("Category"), confirm },
    handler: async ({ category_id }, ctx) => {
      const category = await ownedCategory(ctx, category_id);
      const { error } = await ctx.supabase.from("categories").delete().eq("id", category_id).eq("user_id", ctx.userId);
      throwIf(error);
      return { deleted: { id: category.id, name: category.name } };
    },
  }),
];
