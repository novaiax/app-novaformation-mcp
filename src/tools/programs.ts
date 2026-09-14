import { z } from "zod";
import { color, confirm, defineTool, definedOnly, icon, id, percent, throwIf } from "./define.js";
import { ownedModule, ownedModuleItem, ownedProgram, ownedWeek } from "./ownership.js";
import { badRequest } from "./result.js";
import type { ToolContext } from "../context.js";
import { computeProgramProgress } from "../domain/programs.js";
import { setModuleItemCompletion } from "../services/program-item-completion.js";
import type { ModuleItemType, Tables } from "../domain/database.js";

const ITEM_TYPES = ["lesson", "book", "exercise", "objective", "custom_task"] as const satisfies readonly ModuleItemType[];
const PROGRAM_STATUSES = ["active", "completed", "archived"] as const;

const itemInput = z.object({
  title: z.string().trim().min(1).max(300),
  type: z.enum(ITEM_TYPES).default("custom_task").describe("lesson | book | exercise | objective | custom_task"),
  description: z.string().max(10000).optional(),
  xp_value: z.number().int().min(0).max(100000).default(10).describe("XP granted when completed (default 10)"),
});

const moduleInput = z.object({
  title: z.string().trim().min(1).max(300),
  items: z.array(itemInput).max(200).optional(),
});

const weekInput = z.object({
  week_number: z.number().int().min(1).max(520).optional().describe("Defaults to the next free week number"),
  title: z.string().max(300).optional().describe('Defaults to "Week N"'),
  modules: z.array(moduleInput).max(50).optional(),
});

type ItemInput = z.infer<typeof itemInput>;
type ModuleInput = z.infer<typeof moduleInput>;
type WeekInput = z.infer<typeof weekInput>;

type ProgramTree = Tables<"programs"> & {
  program_weeks: (Tables<"program_weeks"> & {
    program_modules: (Tables<"program_modules"> & { module_items: Tables<"module_items">[] })[];
  })[];
};

// ------------------------------------------------------------------ helpers

async function insertItems({ supabase }: ToolContext, moduleId: string, items: ItemInput[], startOrder = 0) {
  if (items.length === 0) return [];
  const { data, error } = await supabase
    .from("module_items")
    .insert(
      items.map((item, index) => ({
        module_id: moduleId,
        title: item.title,
        type: item.type,
        description: item.description ?? "",
        xp_value: item.xp_value,
        sort_order: startOrder + index,
      })),
    )
    .select();
  throwIf(error);
  return data ?? [];
}

async function insertModules(ctx: ToolContext, weekId: string, modules: ModuleInput[], startOrder = 0) {
  const created = [];
  for (const [index, module] of modules.entries()) {
    const { data, error } = await ctx.supabase
      .from("program_modules")
      .insert({ week_id: weekId, title: module.title, sort_order: startOrder + index })
      .select()
      .single();
    throwIf(error);
    const items = await insertItems(ctx, data!.id, module.items ?? []);
    created.push({ ...data!, module_items: items });
  }
  return created;
}

async function insertWeeks(ctx: ToolContext, programId: string, weeks: WeekInput[]) {
  const { data: existing, error } = await ctx.supabase
    .from("program_weeks")
    .select("week_number")
    .eq("program_id", programId);
  throwIf(error);
  const taken = new Set((existing ?? []).map((w) => w.week_number));

  const created = [];
  for (const week of weeks) {
    let weekNumber = week.week_number;
    if (weekNumber === undefined) {
      weekNumber = 1;
      while (taken.has(weekNumber)) weekNumber += 1;
    } else if (taken.has(weekNumber)) {
      badRequest(`Week ${weekNumber} already exists in this program`);
    }
    taken.add(weekNumber);

    const { data, error: insertError } = await ctx.supabase
      .from("program_weeks")
      .insert({
        program_id: programId,
        week_number: weekNumber,
        title: week.title ?? `Week ${weekNumber}`,
        sort_order: weekNumber,
      })
      .select()
      .single();
    throwIf(insertError);
    const modules = await insertModules(ctx, data!.id, week.modules ?? []);
    created.push({ ...data!, program_modules: modules });
  }
  return created;
}

async function loadProgramTree({ supabase, userId }: ToolContext, programId: string) {
  const { data, error } = await supabase
    .from("programs")
    .select("*, program_weeks ( *, program_modules ( *, module_items ( * ) ) )")
    .eq("id", programId)
    .eq("user_id", userId)
    .order("week_number", { referencedTable: "program_weeks", ascending: true })
    .order("sort_order", { referencedTable: "program_weeks.program_modules", ascending: true })
    .order("sort_order", { referencedTable: "program_weeks.program_modules.module_items", ascending: true })
    .single();
  throwIf(error);
  return data as unknown as ProgramTree;
}

function presentProgram(program: ProgramTree) {
  const progress = computeProgramProgress(program);
  return {
    id: program.id,
    title: program.title,
    description: program.description,
    icon: program.icon,
    color: program.color,
    status: program.status,
    duration_weeks: program.duration_weeks,
    created_at: program.created_at,
    updated_at: program.updated_at,
    progress: { completed: progress.completed, total: progress.total, percent: percent(progress.progress) },
    weeks: program.program_weeks.map((week) => {
      const weekProgress = computeProgramProgress({ program_weeks: [week] });
      return {
        id: week.id,
        week_number: week.week_number,
        title: week.title,
        progress: { completed: weekProgress.completed, total: weekProgress.total, percent: percent(weekProgress.progress) },
        modules: week.program_modules.map((module) => ({
          id: module.id,
          title: module.title,
          sort_order: module.sort_order,
          items: module.module_items.map((item) => ({
            id: item.id,
            type: item.type,
            title: item.title,
            description: item.description,
            xp_value: item.xp_value,
            is_completed: item.is_completed,
            completed_at: item.completed_at,
            sort_order: item.sort_order,
          })),
        })),
      };
    }),
  };
}

// -------------------------------------------------------------------- tools

export const programTools = [
  defineTool({
    name: "list_programs",
    title: "List programs",
    description: "Liste les programmes (formations structurees en semaines > modules > elements) avec leur progression.",
    kind: "read",
    input: { status: z.enum(PROGRAM_STATUSES).optional().describe("Filter by status") },
    handler: async ({ status }, { supabase, userId }) => {
      let query = supabase
        .from("programs")
        .select("*, program_weeks ( id, program_modules ( id, module_items ( id, is_completed ) ) )")
        .eq("user_id", userId)
        .order("sort_order", { ascending: true });
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      throwIf(error);

      type Row = Tables<"programs"> & {
        program_weeks: { program_modules: { module_items: { is_completed: boolean }[] }[] }[];
      };
      return ((data ?? []) as unknown as Row[]).map((program) => {
        const progress = computeProgramProgress(program);
        return {
          id: program.id,
          title: program.title,
          description: program.description,
          status: program.status,
          duration_weeks: program.duration_weeks,
          weeks: program.program_weeks.length,
          progress: { completed: progress.completed, total: progress.total, percent: percent(progress.progress) },
          updated_at: program.updated_at,
        };
      });
    },
  }),

  defineTool({
    name: "get_program",
    title: "Get program",
    description: "Detail complet d'un programme : semaines, modules, elements (avec ids, XP, statut) et progression.",
    kind: "read",
    input: { program_id: id("Program") },
    handler: async ({ program_id }, ctx) => {
      await ownedProgram(ctx, program_id);
      return presentProgram(await loadProgramTree(ctx, program_id));
    },
  }),

  defineTool({
    name: "create_program",
    title: "Create program",
    description:
      "Cree un programme. Peut creer toute la structure en un appel via `weeks` (semaines > modules > elements).",
    kind: "write",
    input: {
      title: z.string().trim().min(1).max(200),
      description: z.string().max(10000).optional(),
      icon: icon.optional(),
      color: color.optional(),
      duration_weeks: z.number().int().min(1).max(520).optional().describe("Default 12"),
      status: z.enum(PROGRAM_STATUSES).optional(),
      weeks: z.array(weekInput).max(104).optional(),
    },
    handler: async ({ weeks, ...fields }, ctx) => {
      const { data: last } = await ctx.supabase
        .from("programs")
        .select("sort_order")
        .eq("user_id", ctx.userId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data, error } = await ctx.supabase
        .from("programs")
        .insert({
          user_id: ctx.userId,
          title: fields.title,
          description: fields.description ?? "",
          icon: fields.icon ?? "Sparkles",
          color: fields.color ?? "#6366f1",
          duration_weeks: fields.duration_weeks ?? 12,
          status: fields.status ?? "active",
          sort_order: (last?.sort_order ?? -1) + 1,
        })
        .select()
        .single();
      throwIf(error);
      if (weeks?.length) await insertWeeks(ctx, data!.id, weeks);
      return { created: presentProgram(await loadProgramTree(ctx, data!.id)) };
    },
  }),

  defineTool({
    name: "update_program",
    title: "Update program",
    description: "Modifie un programme (seuls les champs fournis changent). status : active | completed | archived.",
    kind: "write",
    input: {
      program_id: id("Program"),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(10000).optional(),
      icon: icon.optional(),
      color: color.optional(),
      duration_weeks: z.number().int().min(1).max(520).optional(),
      status: z.enum(PROGRAM_STATUSES).optional(),
      sort_order: z.number().int().min(0).optional(),
    },
    handler: async ({ program_id, ...values }, ctx) => {
      await ownedProgram(ctx, program_id);
      const update = definedOnly(values);
      if (Object.keys(update).length === 0) badRequest("Nothing to update");
      const { data, error } = await ctx.supabase
        .from("programs")
        .update(update)
        .eq("id", program_id)
        .eq("user_id", ctx.userId)
        .select()
        .single();
      throwIf(error);
      return { updated: data };
    },
  }),

  defineTool({
    name: "delete_program",
    title: "Delete program",
    description:
      "Supprime DEFINITIVEMENT un programme et toute sa structure. Preferer update_program status=archived pour le ranger.",
    kind: "delete",
    input: { program_id: id("Program"), confirm },
    handler: async ({ program_id }, ctx) => {
      const program = await ownedProgram(ctx, program_id);
      const { error } = await ctx.supabase.from("programs").delete().eq("id", program_id).eq("user_id", ctx.userId);
      throwIf(error);
      return { deleted: { id: program.id, title: program.title } };
    },
  }),

  defineTool({
    name: "add_weeks",
    title: "Add weeks",
    description: "Ajoute une ou plusieurs semaines a un programme, avec leurs modules et elements si fournis.",
    kind: "write",
    input: { program_id: id("Program"), weeks: z.array(weekInput).min(1).max(104) },
    handler: async ({ program_id, weeks }, ctx) => {
      await ownedProgram(ctx, program_id);
      const created = await insertWeeks(ctx, program_id, weeks);
      return { created: created.map((w) => ({ id: w.id, week_number: w.week_number, title: w.title, modules: w.program_modules.length })) };
    },
  }),

  defineTool({
    name: "update_week",
    title: "Update week",
    description: "Renomme une semaine ou change son numero.",
    kind: "write",
    input: {
      week_id: id("Week"),
      title: z.string().max(300).optional(),
      week_number: z.number().int().min(1).max(520).optional(),
    },
    handler: async ({ week_id, title, week_number }, ctx) => {
      await ownedWeek(ctx, week_id);
      const update = definedOnly({ title, week_number, sort_order: week_number });
      if (Object.keys(update).length === 0) badRequest("Nothing to update");
      const { data, error } = await ctx.supabase.from("program_weeks").update(update).eq("id", week_id).select().single();
      throwIf(error);
      return { updated: data };
    },
  }),

  defineTool({
    name: "delete_week",
    title: "Delete week",
    description: "Supprime DEFINITIVEMENT une semaine avec ses modules et elements.",
    kind: "delete",
    input: { week_id: id("Week"), confirm },
    handler: async ({ week_id }, ctx) => {
      const week = await ownedWeek(ctx, week_id);
      const { error } = await ctx.supabase.from("program_weeks").delete().eq("id", week_id);
      throwIf(error);
      return { deleted: { id: week.id, week_number: week.week_number, title: week.title } };
    },
  }),

  defineTool({
    name: "add_modules",
    title: "Add modules",
    description: "Ajoute un ou plusieurs modules a une semaine, avec leurs elements si fournis.",
    kind: "write",
    input: { week_id: id("Week"), modules: z.array(moduleInput).min(1).max(50) },
    handler: async ({ week_id, modules }, ctx) => {
      await ownedWeek(ctx, week_id);
      const { count } = await ctx.supabase
        .from("program_modules")
        .select("id", { count: "exact", head: true })
        .eq("week_id", week_id);
      const created = await insertModules(ctx, week_id, modules, count ?? 0);
      return { created: created.map((m) => ({ id: m.id, title: m.title, items: m.module_items.length })) };
    },
  }),

  defineTool({
    name: "update_module",
    title: "Update module",
    description: "Renomme un module, change son ordre ou le deplace dans une autre semaine du meme programme.",
    kind: "write",
    input: {
      module_id: id("Module"),
      title: z.string().trim().min(1).max(300).optional(),
      sort_order: z.number().int().min(0).optional(),
      week_id: id("Target week").optional(),
    },
    handler: async ({ module_id, title, sort_order, week_id }, ctx) => {
      const { programId } = await ownedModule(ctx, module_id);
      if (week_id) {
        const week = await ownedWeek(ctx, week_id);
        if (week.program_id !== programId) badRequest("A module can only move to a week of the same program");
      }
      const update = definedOnly({ title, sort_order, week_id });
      if (Object.keys(update).length === 0) badRequest("Nothing to update");
      const { data, error } = await ctx.supabase.from("program_modules").update(update).eq("id", module_id).select().single();
      throwIf(error);
      return { updated: data };
    },
  }),

  defineTool({
    name: "delete_module",
    title: "Delete module",
    description: "Supprime DEFINITIVEMENT un module avec ses elements.",
    kind: "delete",
    input: { module_id: id("Module"), confirm },
    handler: async ({ module_id }, ctx) => {
      const { module } = await ownedModule(ctx, module_id);
      const { error } = await ctx.supabase.from("program_modules").delete().eq("id", module_id);
      throwIf(error);
      return { deleted: { id: module.id, title: module.title } };
    },
  }),

  defineTool({
    name: "add_module_items",
    title: "Add module items",
    description:
      "Ajoute des elements a un module (lecon, livre, exercice, objectif, tache), a la suite des elements existants.",
    kind: "write",
    input: { module_id: id("Module"), items: z.array(itemInput).min(1).max(200) },
    handler: async ({ module_id, items }, ctx) => {
      await ownedModule(ctx, module_id);
      const { count } = await ctx.supabase
        .from("module_items")
        .select("id", { count: "exact", head: true })
        .eq("module_id", module_id);
      return { created: await insertItems(ctx, module_id, items, count ?? 0) };
    },
  }),

  defineTool({
    name: "update_module_item",
    title: "Update module item",
    description:
      "Modifie un element (titre, type, description, XP, ordre) ou le deplace dans un autre module du meme programme. " +
      "Pour le cocher, utiliser set_module_items_completed.",
    kind: "write",
    input: {
      item_id: id("Module item"),
      title: z.string().trim().min(1).max(300).optional(),
      type: z.enum(ITEM_TYPES).optional(),
      description: z.string().max(10000).optional(),
      xp_value: z.number().int().min(0).max(100000).optional(),
      sort_order: z.number().int().min(0).optional(),
      module_id: id("Target module").optional(),
    },
    handler: async ({ item_id, module_id, ...values }, ctx) => {
      const { programId } = await ownedModuleItem(ctx, item_id);
      if (module_id) {
        const target = await ownedModule(ctx, module_id);
        if (target.programId !== programId) badRequest("An item can only move to a module of the same program");
      }
      const update = definedOnly({ ...values, module_id });
      if (Object.keys(update).length === 0) badRequest("Nothing to update");
      const { data, error } = await ctx.supabase.from("module_items").update(update).eq("id", item_id).select().single();
      throwIf(error);
      return { updated: data };
    },
  }),

  defineTool({
    name: "set_module_items_completed",
    title: "Complete module items",
    description:
      "Coche ou decoche des elements de programme. Cocher accorde l'XP de l'element, decocher la retire " +
      "(meme logique que l'app ; un element deja dans l'etat demande est laisse tel quel, sans XP en double).",
    kind: "write",
    input: {
      item_ids: z.array(id("Module item")).min(1).max(200),
      completed: z.boolean(),
    },
    handler: async ({ item_ids, completed }, ctx) => {
      const results = [];
      for (const itemId of [...new Set(item_ids)]) {
        const { item } = await ownedModuleItem(ctx, itemId);
        if (item.is_completed === completed) {
          results.push({ id: item.id, title: item.title, changed: false, is_completed: completed });
          continue;
        }
        await setModuleItemCompletion(ctx.supabase, ctx.userId, item.id, completed, item.xp_value);
        results.push({
          id: item.id,
          title: item.title,
          changed: true,
          is_completed: completed,
          xp: completed ? item.xp_value : -item.xp_value,
        });
      }
      return { results };
    },
  }),

  defineTool({
    name: "reorder_module_items",
    title: "Reorder module items",
    description: "Reordonne les elements d'un module : `item_ids` dans le nouvel ordre (tous les elements du module).",
    kind: "write",
    input: { module_id: id("Module"), item_ids: z.array(id("Module item")).min(1).max(500) },
    handler: async ({ module_id, item_ids }, ctx) => {
      await ownedModule(ctx, module_id);
      const { data, error } = await ctx.supabase.from("module_items").select("id").eq("module_id", module_id);
      throwIf(error);
      const actual = new Set((data ?? []).map((row) => row.id));
      if (item_ids.length !== actual.size || !item_ids.every((itemId) => actual.has(itemId))) {
        badRequest("item_ids must list every item of the module exactly once");
      }
      for (const [index, itemId] of item_ids.entries()) {
        const { error: updateError } = await ctx.supabase.from("module_items").update({ sort_order: index }).eq("id", itemId);
        throwIf(updateError);
      }
      return { reordered: item_ids.length };
    },
  }),

  defineTool({
    name: "delete_module_items",
    title: "Delete module items",
    description: "Supprime DEFINITIVEMENT des elements de programme.",
    kind: "delete",
    input: { item_ids: z.array(id("Module item")).min(1).max(200), confirm },
    handler: async ({ item_ids }, ctx) => {
      const deleted = [];
      for (const itemId of [...new Set(item_ids)]) {
        const { item } = await ownedModuleItem(ctx, itemId);
        const { error } = await ctx.supabase.from("module_items").delete().eq("id", itemId);
        throwIf(error);
        deleted.push({ id: item.id, title: item.title });
      }
      return { deleted };
    },
  }),
];
