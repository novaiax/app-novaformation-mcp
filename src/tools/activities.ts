import { z } from "zod";
import { color, confirm, dateKey, defineTool, definedOnly, id, limit, throwIf } from "./define.js";
import { ownedActivity, ownedActivitySession, ownedCategory, ownedProgram, ownedSkill } from "./ownership.js";
import { badRequest } from "./result.js";
import type { ToolContext } from "../context.js";
import type { Tables } from "../domain/database.js";
import { activityPeriodSeries, activityTimeBreakdowns, computeActivityStats, todayInParis,
  type ActivityData } from "../domain/activities.js";

const status = z.enum(["planned", "active", "paused", "completed", "archived"]);
const kind = z.enum(["recurring", "one_off", "free"]);
const sessionStatus = z.enum(["planned", "done", "missed", "cancelled_self", "cancelled_organizer", "postponed"]);
const goalType = z.enum(["sessions", "hours", "attendance"]);
const frequency = z.enum(["weekly", "every_n_days"]);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, "HH:mm or HH:mm:ss");
const url = z.string().url().refine((value) => /^https?:\/\//.test(value), "http(s) URL required");
const minutes = z.number().int().min(0).max(10080);
const recurrence = z.object({
  frequency: frequency.default("weekly"),
  week_interval: z.number().int().min(1).max(52).default(1),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  times_per_week: z.number().int().min(1).max(7).nullable().default(null),
  interval_days: z.number().int().min(1).max(365).default(1),
  start_time: time.nullable().default(null),
  planned_minutes: minutes.nullable().default(null),
  anchor_date: dateKey.nullable().default(null),
});

const activityFields = {
  name: z.string().trim().min(1).max(300),
  category_id: id("Category").nullable().default(null),
  description: z.string().max(20000).default(""),
  icon: z.string().min(1).max(60).default("Sparkles"),
  color: color.default("#0071e3"),
  status: status.default("planned"),
  kind: kind.default("free"),
  start_date: dateKey,
  end_date: dateKey.nullable().default(null),
  planned_minutes: minutes.default(60),
  usual_time: time.nullable().default(null),
  place: z.string().max(500).default(""),
  organizer: z.string().max(500).default(""),
  url: url.nullable().default(null),
  goal_type: goalType.nullable().default(null),
  goal_target: z.number().positive().max(100000).nullable().default(null),
};

const sessionFields = {
  activity_id: id("Activity"),
  session_date: dateKey,
  start_time: time.nullable().default(null),
  planned_minutes: minutes.default(0),
  actual_minutes: minutes.nullable().default(null),
  status: sessionStatus.default("planned"),
  feedback_score: z.number().int().min(1).max(10).nullable().default(null),
  notes: z.string().max(20000).default(""),
  comment: z.string().max(20000).default(""),
  url: url.nullable().default(null),
};

async function allSessions(ctx: ToolContext) {
  const sessions: Tables<"activity_sessions">[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await ctx.supabase.from("activity_sessions").select("*")
      .eq("user_id", ctx.userId).order("session_date").order("id")
      .range(offset, offset + 499);
    throwIf(error);
    sessions.push(...(data ?? []));
    if (!data || data.length < 500) return sessions;
  }
}

async function loadActivityData(ctx: ToolContext): Promise<ActivityData> {
  const activities = await ctx.supabase.from("activities").select("*")
    .eq("user_id", ctx.userId).order("sort_order");
  throwIf(activities.error);
  const today = todayInParis();
  for (const activity of activities.data ?? []) {
    if (activity.kind !== "recurring" || ["paused", "completed", "archived"].includes(activity.status) ||
      (activity.end_date && activity.end_date < today) ||
      (activity.schedule_refreshed_until && activity.schedule_refreshed_until >= today)) continue;
    const { error } = await ctx.supabase.rpc("nf_refresh_activity_occurrences", {
      p_activity_id: activity.id, p_user_id: ctx.userId,
    });
    throwIf(error);
  }
  const [sessions, rules, skills, activitySkills, activityPrograms,
    sessionSkills, suppressed, categories, programs] = await Promise.all([
    allSessions(ctx),
    ctx.supabase.from("activity_recurrence_rules").select("*").eq("user_id", ctx.userId).order("valid_from"),
    ctx.supabase.from("skills").select("*").eq("user_id", ctx.userId).order("sort_order"),
    ctx.supabase.from("activity_skill_links").select("*").eq("user_id", ctx.userId),
    ctx.supabase.from("activity_program_links").select("*").eq("user_id", ctx.userId),
    ctx.supabase.from("activity_session_skills").select("*").eq("user_id", ctx.userId),
    ctx.supabase.from("activity_suppressed_occurrences").select("*").eq("user_id", ctx.userId),
    ctx.supabase.from("categories").select("*").eq("user_id", ctx.userId),
    ctx.supabase.from("programs").select("id,title,color").eq("user_id", ctx.userId),
  ]);
  for (const row of [rules, skills, activitySkills, activityPrograms, sessionSkills, suppressed, categories, programs])
    throwIf(row.error);
  return {
    activities: activities.data ?? [], sessions,
    rules: rules.data ?? [], skills: skills.data ?? [],
    activitySkills: activitySkills.data ?? [], activityPrograms: activityPrograms.data ?? [],
    sessionSkills: sessionSkills.data ?? [], suppressed: suppressed.data ?? [], categories: categories.data ?? [],
    programs: programs.data ?? [],
  };
}

function presentActivity(activity: Tables<"activities">, data: ActivityData) {
  const stats = computeActivityStats(activity, data.sessions);
  return {
    ...activity,
    category: data.categories.find((row) => row.id === activity.category_id)?.name ?? null,
    skills: data.activitySkills.filter((row) => row.activity_id === activity.id)
      .map((row) => data.skills.find((skill) => skill.id === row.skill_id)).filter(Boolean),
    programs: data.activityPrograms.filter((row) => row.activity_id === activity.id)
      .map((row) => data.programs.find((program) => program.id === row.program_id)).filter(Boolean),
    recurrence_rules: data.rules.filter((row) => row.activity_id === activity.id),
    suppressed_occurrences: data.suppressed.filter((row) => row.activity_id === activity.id).map((row) => row.occurrence_date),
    statistics: stats,
  };
}

function checkGoal(type: string | null, target: number | null) {
  if ((type === null) !== (target === null)) badRequest("goal_type and goal_target must be set together");
  if (type === "attendance" && target !== null && target > 100) badRequest("Attendance target cannot exceed 100%");
}

async function setLinks(ctx: ToolContext, activityId: string, skillIds: string[], programIds: string[]) {
  const { error } = await ctx.supabase.rpc("nf_set_activity_links", {
    p_activity_id: activityId, p_skill_ids: skillIds, p_program_ids: programIds, p_user_id: ctx.userId,
  });
  throwIf(error);
}

async function setRecurrence(ctx: ToolContext, activityId: string,
  value: z.infer<typeof recurrence>, scope: "all" | "following", fromDate: string) {
  const { data, error } = await ctx.supabase.rpc("nf_set_activity_recurrence", {
    p_activity_id: activityId, p_scope: scope, p_from_date: fromDate,
    p_frequency: value.frequency, p_week_interval: value.week_interval,
    p_weekdays: value.weekdays, p_times_per_week: value.times_per_week,
    p_interval_days: value.interval_days, p_start_time: value.start_time,
    p_planned_minutes: value.planned_minutes, p_anchor_date: value.anchor_date,
    p_user_id: ctx.userId,
  });
  throwIf(error);
  return data;
}

export const activityTools = [
  defineTool({
    name: "list_activities", title: "List activities", kind: "read",
    description: "Liste les activités réelles avec catégorie, compétences, programmes, récurrence et statistiques. Filtre par statut ou catégorie.",
    input: { status: status.optional(), category_id: id("Category").optional(),
      include_archived: z.boolean().default(false), offset: z.number().int().min(0).default(0),
      max_results: limit(50, 200) },
    handler: async ({ status: filterStatus, category_id, include_archived, offset, max_results }, ctx) => {
      const data = await loadActivityData(ctx);
      const rows = data.activities.filter((activity) =>
        (!filterStatus || activity.status === filterStatus) &&
        (!category_id || activity.category_id === category_id) &&
        (include_archived || activity.status !== "archived"));
      return { total: rows.length, offset,
        activities: rows.slice(offset, offset + max_results).map((activity) => presentActivity(activity, data)) };
    },
  }),
  defineTool({
    name: "get_activity", title: "Get activity", kind: "read",
    description: "Fiche d’une activité avec statistiques et 30 séances récentes. Utiliser list_activity_sessions pour le reste.",
    input: { activity_id: id("Activity") },
    handler: async ({ activity_id }, ctx) => {
      await ownedActivity(ctx, activity_id);
      const data = await loadActivityData(ctx);
      const activity = data.activities.find((row) => row.id === activity_id)!;
      const sessions = data.sessions.filter((session) => session.activity_id === activity_id)
        .sort((a, b) => b.session_date.localeCompare(a.session_date));
      return { ...presentActivity(activity, data),
        sessions_total: sessions.length, recent_sessions: sessions.slice(0, 30),
      };
    },
  }),
  defineTool({
    name: "search_activities", title: "Search activities", kind: "read",
    description: "Recherche par nom, description, lieu ou organisateur et renvoie les identifiants.",
    input: { query: z.string().trim().min(1).max(200), max_results: limit(25, 100) },
    handler: async ({ query, max_results }, ctx) => {
      const { data, error } = await ctx.supabase.from("activities")
        .select("id,name,description,status,kind,place,organizer")
        .eq("user_id", ctx.userId);
      throwIf(error);
      const needle = query.toLocaleLowerCase("fr");
      return (data ?? []).filter((row) => [row.name, row.description, row.place, row.organizer]
        .some((value) => value.toLocaleLowerCase("fr").includes(needle))).slice(0, max_results);
    },
  }),
  defineTool({
    name: "create_activity", title: "Create activity", kind: "write",
    description: "Crée une activité libre, ponctuelle ou récurrente. Les dates ponctuelles et la série récurrente créent leurs séances.",
    input: { ...activityFields, recurrence: recurrence.optional(),
      one_off_dates: z.array(dateKey).max(200).default([]),
      skill_ids: z.array(id("Skill")).default([]), program_ids: z.array(id("Program")).default([]) },
    handler: async ({ recurrence: rule, one_off_dates, skill_ids, program_ids, ...fields }, ctx) => {
      if (fields.end_date && fields.end_date < fields.start_date) badRequest("end_date precedes start_date");
      checkGoal(fields.goal_type, fields.goal_target);
      if (fields.kind === "recurring" && !rule) badRequest("recurrence is required for a recurring activity");
      if (fields.category_id) await ownedCategory(ctx, fields.category_id);
      for (const skillId of skill_ids) await ownedSkill(ctx, skillId);
      for (const programId of program_ids) await ownedProgram(ctx, programId);
      const { data: last } = await ctx.supabase.from("activities").select("sort_order")
        .eq("user_id", ctx.userId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
      const { data, error } = await ctx.supabase.from("activities")
        .insert({ ...fields, user_id: ctx.userId, sort_order: (last?.sort_order ?? -1) + 1 })
        .select().single();
      throwIf(error);
      try {
        await setLinks(ctx, data!.id, skill_ids, program_ids);
        if (fields.kind === "recurring" && rule) await setRecurrence(ctx, data!.id, rule, "all", fields.start_date);
        if (fields.kind === "one_off" && one_off_dates.length) {
          const { error: datesError } = await ctx.supabase.from("activity_sessions").insert(
            [...new Set(one_off_dates)].sort().map((date) => ({
              activity_id: data!.id, user_id: ctx.userId, session_date: date,
              start_time: fields.usual_time, planned_minutes: fields.planned_minutes,
            })));
          throwIf(datesError);
        }
      } catch (cause) {
        await ctx.supabase.from("activities").delete().eq("id", data!.id).eq("user_id", ctx.userId);
        throw cause;
      }
      return { created: data, sessions_generated: fields.kind === "recurring" || one_off_dates.length > 0 };
    },
  }),
  defineTool({
    name: "update_activity", title: "Update activity", kind: "write",
    description: "Modifie les champs fournis d’une activité. Fournir recurrence et recurrence_scope pour modifier une série.",
    input: { activity_id: id("Activity"),
      name: activityFields.name.optional(), category_id: activityFields.category_id.optional(),
      description: activityFields.description.optional(), icon: activityFields.icon.optional(),
      color: activityFields.color.optional(), status: status.optional(), kind: kind.optional(),
      start_date: dateKey.optional(), end_date: dateKey.nullable().optional(),
      planned_minutes: minutes.optional(), usual_time: time.nullable().optional(),
      place: activityFields.place.optional(), organizer: activityFields.organizer.optional(),
      url: url.nullable().optional(), goal_type: goalType.nullable().optional(),
      goal_target: z.number().positive().max(100000).nullable().optional(),
      recurrence: recurrence.optional(), recurrence_scope: z.enum(["all", "following"]).default("all"),
      from_date: dateKey.optional(), skill_ids: z.array(id("Skill")).optional(),
      program_ids: z.array(id("Program")).optional() },
    handler: async ({ activity_id, recurrence: rule, recurrence_scope, from_date,
      skill_ids, program_ids, ...changes }, ctx) => {
      const current = await ownedActivity(ctx, activity_id);
      const nextStart = changes.start_date ?? current.start_date;
      const nextEnd = changes.end_date === undefined ? current.end_date : changes.end_date;
      if (nextEnd && nextEnd < nextStart) badRequest("end_date precedes start_date");
      checkGoal(changes.goal_type === undefined ? current.goal_type : changes.goal_type,
        changes.goal_target === undefined ? current.goal_target : changes.goal_target);
      if (changes.category_id) await ownedCategory(ctx, changes.category_id);
      if (skill_ids) for (const skillId of skill_ids) await ownedSkill(ctx, skillId);
      if (program_ids) for (const programId of program_ids) await ownedProgram(ctx, programId);
      const update = definedOnly(changes);
      if (Object.keys(update).length) {
        const { error } = await ctx.supabase.from("activities").update(update)
          .eq("id", activity_id).eq("user_id", ctx.userId);
        throwIf(error);
      }
      const nextKind = changes.kind ?? current.kind;
      if (current.kind === "recurring" && nextKind !== "recurring") {
        const { error } = await ctx.supabase.rpc("nf_clear_activity_recurrence", {
          p_activity_id: activity_id, p_user_id: ctx.userId,
        });
        throwIf(error);
      } else if (nextKind === "recurring") {
        if (rule) await setRecurrence(ctx, activity_id, rule, recurrence_scope, from_date ?? nextStart);
        else if (current.kind !== "recurring") badRequest("recurrence is required when changing to recurring");
        else if (changes.end_date !== undefined || changes.start_date !== undefined || changes.usual_time !== undefined ||
          changes.planned_minutes !== undefined || changes.status !== undefined) {
          const { error } = await ctx.supabase.rpc("nf_refresh_activity_occurrences", {
            p_activity_id: activity_id, p_user_id: ctx.userId,
          });
          throwIf(error);
        }
      }
      if (skill_ids || program_ids) {
        const [skills, programs] = await Promise.all([
          ctx.supabase.from("activity_skill_links").select("skill_id").eq("activity_id", activity_id).eq("user_id", ctx.userId),
          ctx.supabase.from("activity_program_links").select("program_id").eq("activity_id", activity_id).eq("user_id", ctx.userId),
        ]);
        throwIf(skills.error); throwIf(programs.error);
        await setLinks(ctx, activity_id, skill_ids ?? (skills.data ?? []).map((row) => row.skill_id),
          program_ids ?? (programs.data ?? []).map((row) => row.program_id));
      }
      return { updated: await ownedActivity(ctx, activity_id) };
    },
  }),
  defineTool({
    name: "archive_activity", title: "Archive activity", kind: "write",
    description: "Archive une activité sans effacer son historique.",
    input: { activity_id: id("Activity") },
    handler: async ({ activity_id }, ctx) => {
      const activity = await ownedActivity(ctx, activity_id);
      const { error } = await ctx.supabase.from("activities").update({ status: "archived" })
        .eq("id", activity_id).eq("user_id", ctx.userId);
      throwIf(error);
      if (activity.kind === "recurring") {
        const { error: refreshError } = await ctx.supabase.rpc("nf_refresh_activity_occurrences", {
          p_activity_id: activity_id, p_user_id: ctx.userId,
        });
        throwIf(refreshError);
      }
      return { archived: activity_id };
    },
  }),
  defineTool({
    name: "duplicate_activity", title: "Duplicate activity", kind: "write",
    description: "Duplique la structure, la récurrence et les liens d’une activité sans recopier les séances réalisées.",
    input: { activity_id: id("Activity") },
    handler: async ({ activity_id }, ctx) => {
      await ownedActivity(ctx, activity_id);
      const { data, error } = await ctx.supabase.rpc("nf_duplicate_activity", {
        p_activity_id: activity_id, p_user_id: ctx.userId,
      });
      throwIf(error);
      return { created_id: data };
    },
  }),
  defineTool({
    name: "reorder_activities", title: "Reorder activities", kind: "write",
    description: "Réorganise toutes les activités du compte dans l’ordre donné, de façon atomique.",
    input: { activity_ids: z.array(id("Activity")) },
    handler: async ({ activity_ids }, ctx) => {
      const { error } = await ctx.supabase.rpc("nf_reorder_activities", {
        p_order: activity_ids, p_user_id: ctx.userId,
      });
      throwIf(error);
      return { ordered: activity_ids };
    },
  }),
  defineTool({
    name: "delete_activity", title: "Delete activity", kind: "delete",
    description: "Supprime définitivement l’activité et toutes ses séances. Préférer archive_activity pour la conserver.",
    input: { activity_id: id("Activity"), confirm },
    handler: async ({ activity_id }, ctx) => {
      const activity = await ownedActivity(ctx, activity_id);
      const { data: files, error: filesError } = await ctx.supabase.from("activity_sessions")
        .select("attachment_path").eq("activity_id", activity_id).eq("user_id", ctx.userId)
        .not("attachment_path", "is", null);
      throwIf(filesError);
      const { error } = await ctx.supabase.from("activities").delete()
        .eq("id", activity_id).eq("user_id", ctx.userId);
      throwIf(error);
      const paths = (files ?? []).map((row) => row.attachment_path).filter((path): path is string => Boolean(path));
      if (paths.length) await ctx.supabase.storage.from("activity-attachments").remove(paths);
      return { deleted: { id: activity.id, name: activity.name } };
    },
  }),
  defineTool({
    name: "set_activity_recurrence", title: "Set activity recurrence", kind: "write",
    description: "Modifie toute la série ou la séance indiquée et les suivantes. Préserve les séances réalisées et les exceptions.",
    input: { activity_id: id("Activity"), scope: z.enum(["all", "following"]), from_date: dateKey,
      recurrence },
    handler: async ({ activity_id, scope, from_date, recurrence: rule }, ctx) => {
      const activity = await ownedActivity(ctx, activity_id);
      if (activity.kind !== "recurring") badRequest("Activity is not recurring");
      const ruleId = await setRecurrence(ctx, activity_id, rule, scope, from_date);
      return { rule_id: ruleId, activity_id, scope };
    },
  }),
  defineTool({
    name: "set_activity_links", title: "Set activity links", kind: "write",
    description: "Remplace atomiquement les compétences et programmes liés à l’activité.",
    input: { activity_id: id("Activity"), skill_ids: z.array(id("Skill")), program_ids: z.array(id("Program")) },
    handler: async ({ activity_id, skill_ids, program_ids }, ctx) => {
      await ownedActivity(ctx, activity_id);
      await setLinks(ctx, activity_id, skill_ids, program_ids);
      return { activity_id, skill_ids, program_ids };
    },
  }),
  defineTool({
    name: "restore_activity_occurrence", title: "Restore activity occurrence", kind: "write",
    description: "Restaure une occurrence récurrente précédemment retirée, si elle correspond encore à la série actuelle.",
    input: { activity_id: id("Activity"), occurrence_date: dateKey },
    handler: async ({ activity_id, occurrence_date }, ctx) => {
      await ownedActivity(ctx, activity_id);
      const { error } = await ctx.supabase.rpc("nf_restore_activity_occurrence", {
        p_activity_id: activity_id, p_occurrence_date: occurrence_date, p_user_id: ctx.userId,
      });
      throwIf(error);
      return { activity_id, occurrence_date, restored: true };
    },
  }),
];

function weekday(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function ruleWeekdays(rule: Tables<"activity_recurrence_rules">): number[] {
  if (rule.weekdays.length) return rule.weekdays;
  return [[], [1], [1, 4], [1, 3, 5], [1, 2, 4, 5],
    [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6]][rule.times_per_week ?? 1];
}

export const activitySessionTools = [
  defineTool({
    name: "list_activity_sessions", title: "List activity sessions", kind: "read",
    description: "Séances chronologiques filtrables par activité, statut, catégorie, compétence et période. Résultat paginé.",
    input: { activity_id: id("Activity").optional(), status: sessionStatus.optional(),
      category_id: id("Category").optional(), skill_id: id("Skill").optional(),
      from_date: dateKey.optional(), to_date: dateKey.optional(),
      offset: z.number().int().min(0).default(0), max_results: limit(100, 500) },
    handler: async ({ activity_id, status: filterStatus, category_id, skill_id,
      from_date, to_date, offset, max_results }, ctx) => {
      if (activity_id) await ownedActivity(ctx, activity_id);
      if (category_id) await ownedCategory(ctx, category_id);
      if (skill_id) await ownedSkill(ctx, skill_id);
      const data = await loadActivityData(ctx);
      const rows = data.sessions.filter((session) => {
        const activity = data.activities.find((item) => item.id === session.activity_id);
        if (!activity) return false;
        if (activity_id && session.activity_id !== activity_id) return false;
        if (filterStatus && session.status !== filterStatus) return false;
        if (category_id && activity.category_id !== category_id) return false;
        if (from_date && session.session_date < from_date) return false;
        if (to_date && session.session_date > to_date) return false;
        if (skill_id) {
          const explicit = data.sessionSkills.filter((link) => link.session_id === session.id);
          if (explicit.length ? !explicit.some((link) => link.skill_id === skill_id)
            : session.skill_snapshot_complete ||
              !data.activitySkills.some((link) => link.activity_id === activity.id && link.skill_id === skill_id)) return false;
        }
        return true;
      }).sort((a, b) => a.session_date.localeCompare(b.session_date) || a.sort_order - b.sort_order);
      return { total: rows.length, offset, sessions: rows.slice(offset, offset + max_results).map((session) => ({
        ...session, activity_name: data.activities.find((item) => item.id === session.activity_id)?.name ?? null,
        skill_ids: data.sessionSkills.filter((link) => link.session_id === session.id).map((link) => link.skill_id),
      })) };
    },
  }),
  defineTool({
    name: "add_activity_session", title: "Add activity session", kind: "write",
    description: "Ajoute une séance manuelle à n’importe quelle date, même pour une activité récurrente.",
    input: { ...sessionFields, skill_ids: z.array(id("Skill")).default([]) },
    handler: async ({ skill_ids, ...fields }, ctx) => {
      await ownedActivity(ctx, fields.activity_id);
      const { data: last } = await ctx.supabase.from("activity_sessions").select("sort_order")
        .eq("activity_id", fields.activity_id).eq("session_date", fields.session_date)
        .order("sort_order", { ascending: false }).limit(1).maybeSingle();
      const { data, error } = await ctx.supabase.from("activity_sessions")
        .insert({ ...fields, user_id: ctx.userId, source: "manual",
          actual_minutes: fields.status === "done" ? (fields.actual_minutes ?? fields.planned_minutes) : null,
          sort_order: (last?.sort_order ?? -1) + 1 })
        .select().single();
      throwIf(error);
      if (skill_ids.length) {
        const { error: skillError } = await ctx.supabase.rpc("nf_set_activity_session_skills", {
          p_session_id: data!.id, p_skill_ids: skill_ids, p_user_id: ctx.userId,
        });
        if (skillError) {
          await ctx.supabase.from("activity_sessions").delete().eq("id", data!.id).eq("user_id", ctx.userId);
          throw skillError;
        }
      }
      return { created: data };
    },
  }),
  defineTool({
    name: "update_activity_session", title: "Update activity session", kind: "write",
    description: "Modifie une occurrence seulement. Une date ou une activité différente devient une exception persistante.",
    input: { session_id: id("Activity session"), activity_id: id("Activity").optional(),
      session_date: dateKey.optional(), start_time: time.nullable().optional(),
      planned_minutes: minutes.optional(), actual_minutes: minutes.nullable().optional(),
      status: sessionStatus.optional(), feedback_score: z.number().int().min(1).max(10).nullable().optional(),
      notes: z.string().max(20000).optional(), comment: z.string().max(20000).optional(),
      url: url.nullable().optional(), skill_ids: z.array(id("Skill")).optional() },
    handler: async ({ session_id, skill_ids, ...changes }, ctx) => {
      const original = await ownedActivitySession(ctx, session_id);
      const targetActivity = changes.activity_id ?? original.activity_id;
      const targetDate = changes.session_date ?? original.session_date;
      const targetTime = changes.start_time === undefined ? original.start_time : changes.start_time;
      if (targetActivity !== original.activity_id || targetDate !== original.session_date ||
        targetTime !== original.start_time) {
        await ownedActivity(ctx, targetActivity);
        const { error } = await ctx.supabase.rpc("nf_move_activity_session", {
          p_session_id: session_id, p_target_activity_id: targetActivity,
          p_date: targetDate, p_time: targetTime, p_user_id: ctx.userId,
        });
        throwIf(error);
      }
      const update = definedOnly({ ...changes,
        actual_minutes: (changes.status ?? original.status) === "done"
          ? (changes.actual_minutes === undefined ? (original.actual_minutes ?? changes.planned_minutes ?? original.planned_minutes) : changes.actual_minutes)
          : null,
        is_exception: original.source === "generated" || original.is_exception,
      });
      const { error } = await ctx.supabase.from("activity_sessions").update(update)
        .eq("id", session_id).eq("user_id", ctx.userId);
      throwIf(error);
      if (skill_ids) {
        const { error: skillError } = await ctx.supabase.rpc("nf_set_activity_session_skills", {
          p_session_id: session_id, p_skill_ids: skill_ids, p_user_id: ctx.userId,
        });
        throwIf(skillError);
      }
      return { updated: await ownedActivitySession(ctx, session_id) };
    },
  }),
  defineTool({
    name: "update_activity_session_schedule", title: "Update recurring session schedule", kind: "write",
    description: "Déplace une séance seule, cette séance et les suivantes, ou toute la série. Les séances réalisées et exceptions ne changent pas automatiquement.",
    input: { session_id: id("Activity session"), scope: z.enum(["one", "following", "all"]),
      date: dateKey, start_time: time.nullable(), planned_minutes: minutes },
    handler: async ({ session_id, scope, date, start_time, planned_minutes }, ctx) => {
      const session = await ownedActivitySession(ctx, session_id);
      if (scope === "one" || session.source !== "generated") {
        const { error: moveError } = await ctx.supabase.rpc("nf_move_activity_session", {
          p_session_id: session_id, p_target_activity_id: session.activity_id,
          p_date: date, p_time: start_time, p_user_id: ctx.userId,
        });
        throwIf(moveError);
        const { error } = await ctx.supabase.from("activity_sessions")
          .update({ planned_minutes }).eq("id", session_id).eq("user_id", ctx.userId);
        throwIf(error);
        return { updated: await ownedActivitySession(ctx, session_id) };
      }
      const originalDate = session.occurrence_date ?? session.session_date;
      const { data: rules, error: rulesError } = await ctx.supabase.from("activity_recurrence_rules")
        .select("*").eq("activity_id", session.activity_id).eq("user_id", ctx.userId)
        .lte("valid_from", originalDate).order("valid_from", { ascending: false });
      throwIf(rulesError);
      const rule = (rules ?? []).find((candidate) => !candidate.valid_until || candidate.valid_until >= originalDate);
      if (!rule) badRequest("Recurrence rule not found for the session");
      if (rule.frequency === "weekly" && weekday(originalDate) !== weekday(date) &&
        ruleWeekdays(rule).includes(weekday(date))) badRequest("Target weekday already belongs to this series");
      const days = rule.frequency === "weekly"
        ? [...new Set(ruleWeekdays(rule).map((day) => day === weekday(originalDate) ? weekday(date) : day))].sort()
        : rule.weekdays;
      const newRuleId = await setRecurrence(ctx, session.activity_id, {
        frequency: rule.frequency, week_interval: rule.week_interval, weekdays: days,
        times_per_week: rule.frequency === "weekly" ? null : rule.times_per_week,
        interval_days: rule.interval_days, start_time, planned_minutes,
        anchor_date: rule.frequency === "every_n_days" ? date : rule.anchor_date,
      }, scope === "all" ? "all" : "following", originalDate);
      return { activity_id: session.activity_id, rule_id: newRuleId, scope };
    },
  }),
  defineTool({
    name: "set_activity_session_status", title: "Set activity session status", kind: "write",
    description: "Change le statut d’une séance. Une séance réalisée reçoit par défaut sa durée prévue comme durée réelle.",
    input: { session_id: id("Activity session"), status: sessionStatus, actual_minutes: minutes.optional() },
    handler: async ({ session_id, status: nextStatus, actual_minutes }, ctx) => {
      const session = await ownedActivitySession(ctx, session_id);
      const { error } = await ctx.supabase.from("activity_sessions")
        .update({ status: nextStatus,
          actual_minutes: nextStatus === "done" ? (actual_minutes ?? session.actual_minutes ?? session.planned_minutes) : null,
          is_exception: session.source === "generated" || session.is_exception,
        }).eq("id", session_id).eq("user_id", ctx.userId);
      throwIf(error);
      return { updated: await ownedActivitySession(ctx, session_id) };
    },
  }),
  defineTool({
    name: "set_activity_sessions_status", title: "Set activity sessions status", kind: "write",
    description: "Change en une transaction le statut de plusieurs séances du compte.",
    input: { session_ids: z.array(id("Activity session")).min(1).max(200), status: sessionStatus },
    handler: async ({ session_ids, status: nextStatus }, ctx) => {
      const { error } = await ctx.supabase.rpc("nf_batch_set_activity_session_status", {
        p_session_ids: session_ids, p_status: nextStatus, p_user_id: ctx.userId,
      });
      throwIf(error);
      return { updated_ids: session_ids, status: nextStatus };
    },
  }),
  defineTool({
    name: "move_activity_sessions", title: "Move activity sessions", kind: "write",
    description: "Déplace plusieurs séances vers une activité du même compte, en conservant leurs dates ou en donnant une nouvelle date commune.",
    input: { session_ids: z.array(id("Activity session")).min(1).max(200),
      target_activity_id: id("Target activity"), date: dateKey.nullable().default(null) },
    handler: async ({ session_ids, target_activity_id, date }, ctx) => {
      await ownedActivity(ctx, target_activity_id);
      const { error } = await ctx.supabase.rpc("nf_batch_move_activity_sessions", {
        p_session_ids: session_ids, p_target_activity_id: target_activity_id,
        p_date: date, p_user_id: ctx.userId,
      });
      throwIf(error);
      return { moved: session_ids, target_activity_id, date };
    },
  }),
  defineTool({
    name: "duplicate_activity_sessions", title: "Duplicate activity sessions", kind: "write",
    description: "Copie plusieurs séances comme séances manuelles prévues, éventuellement vers une autre activité ou date.",
    input: { session_ids: z.array(id("Activity session")).min(1).max(200),
      target_activity_id: id("Target activity"), date: dateKey.nullable().default(null) },
    handler: async ({ session_ids, target_activity_id, date }, ctx) => {
      await ownedActivity(ctx, target_activity_id);
      const { data, error } = await ctx.supabase.rpc("nf_batch_duplicate_activity_sessions", {
        p_session_ids: session_ids, p_target_activity_id: target_activity_id,
        p_date: date, p_user_id: ctx.userId,
      });
      throwIf(error);
      return { created_ids: data };
    },
  }),
  defineTool({
    name: "delete_activity_sessions", title: "Delete activity sessions", kind: "delete",
    description: "Supprime définitivement une ou plusieurs séances. Une occurrence récurrente supprimée ne réapparaît pas.",
    input: { session_ids: z.array(id("Activity session")).min(1).max(200), confirm },
    handler: async ({ session_ids }, ctx) => {
      const { data: rows, error: readError } = await ctx.supabase.from("activity_sessions")
        .select("id,attachment_path").eq("user_id", ctx.userId).in("id", session_ids);
      throwIf(readError);
      if ((rows ?? []).length !== session_ids.length) badRequest("Session selection outside account");
      const { error } = await ctx.supabase.rpc("nf_batch_delete_activity_sessions", {
        p_session_ids: session_ids, p_user_id: ctx.userId,
      });
      throwIf(error);
      const paths = (rows ?? []).map((row) => row.attachment_path).filter((path): path is string => Boolean(path));
      if (paths.length) await ctx.supabase.storage.from("activity-attachments").remove(paths);
      return { deleted_ids: session_ids };
    },
  }),
  defineTool({
    name: "reorder_activity_sessions", title: "Reorder activity sessions", kind: "write",
    description: "Réordonne toutes les séances d’une journée, quelle que soit leur activité.",
    input: { date: dateKey, session_ids: z.array(id("Activity session")) },
    handler: async ({ date, session_ids }, ctx) => {
      const { error } = await ctx.supabase.rpc("nf_reorder_activity_sessions", {
        p_date: date, p_order: session_ids, p_user_id: ctx.userId,
      });
      throwIf(error);
      return { date, ordered: session_ids };
    },
  }),
  defineTool({
    name: "set_activity_session_skills", title: "Set activity session skills", kind: "write",
    description: "Remplace les compétences travaillées pendant une séance. Liste vide = hériter des compétences de l’activité.",
    input: { session_id: id("Activity session"), skill_ids: z.array(id("Skill")) },
    handler: async ({ session_id, skill_ids }, ctx) => {
      await ownedActivitySession(ctx, session_id);
      const { error } = await ctx.supabase.rpc("nf_set_activity_session_skills", {
        p_session_id: session_id, p_skill_ids: skill_ids, p_user_id: ctx.userId,
      });
      throwIf(error);
      return { session_id, skill_ids };
    },
  }),
  defineTool({
    name: "read_activity_attachment", title: "Read activity attachment", kind: "read",
    description: "Lit une pièce jointe privée en base64. La réponse ne contient aucun lien avec jeton.",
    input: { session_id: id("Activity session"), max_bytes: z.number().int().min(1).max(10485760).default(1048576) },
    handler: async ({ session_id, max_bytes }, ctx) => {
      const session = await ownedActivitySession(ctx, session_id);
      if (!session.attachment_path) badRequest("Session has no attachment");
      const { data, error } = await ctx.supabase.storage.from("activity-attachments")
        .download(session.attachment_path);
      throwIf(error);
      const bytes = Buffer.from(await data!.arrayBuffer());
      if (bytes.length > max_bytes) badRequest(`Attachment is ${bytes.length} bytes; request a higher max_bytes`);
      return { name: session.attachment_name, mime_type: data!.type,
        bytes: bytes.length, base64: bytes.toString("base64") };
    },
  }),
  defineTool({
    name: "upload_activity_attachment", title: "Upload activity attachment", kind: "write",
    description: "Ajoute un fichier privé encodé en base64 à une séance (10 Mo maximum). Remplace l’ancienne pièce jointe.",
    input: { session_id: id("Activity session"), name: z.string().trim().min(1).max(255),
      mime_type: z.string().min(1).max(150), base64: z.string().min(1).max(13981016) },
    handler: async ({ session_id, name, mime_type, base64 }, ctx) => {
      const session = await ownedActivitySession(ctx, session_id);
      const bytes = Buffer.from(base64, "base64");
      if (!bytes.length || bytes.length > 10485760) badRequest("Attachment must be 1 byte to 10 MB");
      const extension = name.split(".").at(-1)?.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "bin";
      const path = `${ctx.userId}/${session_id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await ctx.supabase.storage.from("activity-attachments")
        .upload(path, bytes, { contentType: mime_type, upsert: false });
      throwIf(uploadError);
      const { error } = await ctx.supabase.from("activity_sessions")
        .update({ attachment_path: path, attachment_name: name })
        .eq("id", session_id).eq("user_id", ctx.userId);
      if (error) {
        await ctx.supabase.storage.from("activity-attachments").remove([path]);
        throw error;
      }
      if (session.attachment_path) await ctx.supabase.storage.from("activity-attachments")
        .remove([session.attachment_path]);
      return { session_id, name, bytes: bytes.length };
    },
  }),
  defineTool({
    name: "remove_activity_attachment", title: "Remove activity attachment", kind: "delete",
    description: "Retire définitivement la pièce jointe privée d’une séance, sans supprimer la séance.",
    input: { session_id: id("Activity session"), confirm },
    handler: async ({ session_id }, ctx) => {
      const session = await ownedActivitySession(ctx, session_id);
      if (!session.attachment_path) return { removed: false };
      const { error } = await ctx.supabase.from("activity_sessions")
        .update({ attachment_path: null, attachment_name: null })
        .eq("id", session_id).eq("user_id", ctx.userId);
      throwIf(error);
      await ctx.supabase.storage.from("activity-attachments").remove([session.attachment_path]);
      return { removed: true };
    },
  }),
];

export const activityStatisticsTools = [
  defineTool({
    name: "get_activity_statistics", title: "Get activity statistics", kind: "read",
    description: "Statistiques d’activités filtrables par activité, catégorie, compétence, programme et période ; heures et séances par semaine/mois.",
    input: { activity_id: id("Activity").optional(), category_id: id("Category").optional(),
      skill_id: id("Skill").optional(), program_id: id("Program").optional(),
      from_date: dateKey.optional(), to_date: dateKey.optional(),
      granularity: z.enum(["week", "month"]).default("week") },
    handler: async ({ activity_id, category_id, skill_id, program_id, from_date, to_date, granularity }, ctx) => {
      if (activity_id) await ownedActivity(ctx, activity_id);
      if (category_id) await ownedCategory(ctx, category_id);
      if (skill_id) await ownedSkill(ctx, skill_id);
      if (program_id) await ownedProgram(ctx, program_id);
      const data = await loadActivityData(ctx);
      const today = todayInParis();
      const sessions = data.sessions.filter((session) => {
        const activity = data.activities.find((row) => row.id === session.activity_id);
        if (!activity || session.session_date > today) return false;
        if (activity_id && activity.id !== activity_id) return false;
        if (category_id && activity.category_id !== category_id) return false;
        if (from_date && session.session_date < from_date) return false;
        if (to_date && session.session_date > to_date) return false;
        if (program_id && !data.activityPrograms.some((link) => link.activity_id === activity.id && link.program_id === program_id)) return false;
        if (skill_id) {
          const explicit = data.sessionSkills.filter((link) => link.session_id === session.id);
          if (explicit.length ? !explicit.some((link) => link.skill_id === skill_id)
            : session.skill_snapshot_complete ||
              !data.activitySkills.some((link) => link.activity_id === activity.id && link.skill_id === skill_id)) return false;
        }
        return true;
      });
      const done = sessions.filter((session) => session.status === "done");
      const missed = sessions.filter((session) => session.status === "missed" || session.status === "cancelled_self").length;
      const actualMinutes = done.reduce((sum, session) => sum + (session.actual_minutes ?? 0), 0);
      return {
        totals: {
          sessions: sessions.length, done: done.length, missed,
          cancelled_organizer: sessions.filter((session) => session.status === "cancelled_organizer").length,
          planned_hours: Math.round(sessions.reduce((sum, session) => sum + session.planned_minutes, 0) / 6) / 10,
          actual_hours: Math.round(actualMinutes / 6) / 10,
          average_session_minutes: done.length ? Math.round(actualMinutes / done.length) : 0,
          attendance_percent: done.length + missed ? Math.round(done.length / (done.length + missed) * 1000) / 10 : null,
        },
        time: activityTimeBreakdowns(data, sessions),
        timeline: activityPeriodSeries(sessions, granularity),
      };
    },
  }),
];

export const activitySkillTools = [
  defineTool({
    name: "list_activity_skills", title: "List activity skills", kind: "read",
    description: "Liste les compétences réutilisables dans les activités et séances.",
    input: {},
    handler: async (_args, ctx) => {
      const { data, error } = await ctx.supabase.from("skills").select("*")
        .eq("user_id", ctx.userId).order("sort_order").order("name");
      throwIf(error);
      return data;
    },
  }),
  defineTool({
    name: "create_activity_skill", title: "Create activity skill", kind: "write",
    description: "Crée une compétence réutilisable par plusieurs activités.",
    input: { name: z.string().trim().min(1).max(120), icon: z.string().max(60).default("Sparkles"),
      color: color.default("#6366f1") },
    handler: async ({ name, icon, color: skillColor }, ctx) => {
      const { data: last } = await ctx.supabase.from("skills").select("sort_order")
        .eq("user_id", ctx.userId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
      const { data, error } = await ctx.supabase.from("skills").insert({
        user_id: ctx.userId, name, icon, color: skillColor, sort_order: (last?.sort_order ?? -1) + 1,
      }).select().single();
      throwIf(error);
      return { created: data };
    },
  }),
  defineTool({
    name: "update_activity_skill", title: "Update activity skill", kind: "write",
    description: "Renomme ou recolore une compétence sans perdre ses liens ni ses statistiques.",
    input: { skill_id: id("Skill"), name: z.string().trim().min(1).max(120).optional(),
      icon: z.string().min(1).max(60).optional(), color: color.optional() },
    handler: async ({ skill_id, ...changes }, ctx) => {
      await ownedSkill(ctx, skill_id);
      const update = definedOnly(changes);
      if (!Object.keys(update).length) badRequest("Nothing to update");
      const { data, error } = await ctx.supabase.from("skills").update(update)
        .eq("id", skill_id).eq("user_id", ctx.userId).select().single();
      throwIf(error);
      return { updated: data };
    },
  }),
  defineTool({
    name: "delete_activity_skill", title: "Delete activity skill", kind: "delete",
    description: "Supprime définitivement une compétence ; les activités et séances conservent leurs autres liens.",
    input: { skill_id: id("Skill"), confirm },
    handler: async ({ skill_id }, ctx) => {
      const skill = await ownedSkill(ctx, skill_id);
      const { error } = await ctx.supabase.from("skills").delete()
        .eq("id", skill_id).eq("user_id", ctx.userId);
      throwIf(error);
      return { deleted: { id: skill.id, name: skill.name } };
    },
  }),
  defineTool({
    name: "reorder_activity_skills", title: "Reorder activity skills", kind: "write",
    description: "Réorganise toutes les compétences du compte dans l’ordre donné.",
    input: { skill_ids: z.array(id("Skill")) },
    handler: async ({ skill_ids }, ctx) => {
      const { error } = await ctx.supabase.rpc("nf_reorder_skills", {
        p_order: skill_ids, p_user_id: ctx.userId,
      });
      throwIf(error);
      return { ordered: skill_ids };
    },
  }),
  defineTool({
    name: "duplicate_activity_skill", title: "Duplicate activity skill", kind: "write",
    description: "Duplique une compétence sans recopier ses liens.",
    input: { skill_id: id("Skill") },
    handler: async ({ skill_id }, ctx) => {
      const source = await ownedSkill(ctx, skill_id);
      const { data: rows, error: namesError } = await ctx.supabase.from("skills").select("name,sort_order")
        .eq("user_id", ctx.userId);
      throwIf(namesError);
      const taken = new Set((rows ?? []).map((row) => row.name.toLocaleLowerCase()));
      let name = `${source.name} (copie)`;
      for (let index = 2; taken.has(name.toLocaleLowerCase()); index++) name = `${source.name} (copie ${index})`;
      const { data, error } = await ctx.supabase.from("skills").insert({
        user_id: ctx.userId, name, icon: source.icon, color: source.color,
        sort_order: Math.max(-1, ...(rows ?? []).map((row) => row.sort_order)) + 1,
      }).select().single();
      throwIf(error);
      return { created: data };
    },
  }),
];
