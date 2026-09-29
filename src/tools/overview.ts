import { z } from "zod";
import { subDays, subWeeks } from "date-fns";
import { defineTool, limit, percent, throwIf, timestamp } from "./define.js";
import { getSettings, weekStartsOn } from "../services/settings.js";
import { aggregateProgramsProgress, computeProgramProgress } from "../domain/programs.js";
import { bucketByDay, bucketByWeek } from "../domain/statistics.js";
import { getLevelInfo } from "../domain/xp.js";
import { formatDuration, toDateKey } from "../domain/date.js";
import { groupExerciseStats } from "../domain/exercises.js";
import { todayInParis } from "../domain/activities.js";
import type { XpSource } from "../domain/database.js";

const XP_SOURCES = ["task", "habit", "exercise", "book", "manual"] as const satisfies readonly XpSource[];

const round1 = (value: number) => Math.round(value * 10) / 10;

export const overviewTools = [
  defineTool({
    name: "get_overview",
    title: "Overview",
    description:
      "Vue d'ensemble de NovaFormation, equivalent du Dashboard : niveau et XP, programmes actifs et leur progression, " +
      "heures d'etude, livres en cours et termines, activite exercices (7 derniers jours, objectifs atteints), " +
      "XP des 14 derniers jours. Point de depart pour comprendre ou en est l'utilisateur.",
    kind: "read",
    input: {},
    handler: async (_args, { supabase, userId }) => {
      const now = new Date();
      const [settings, profile, programs, xpAll, tasks, books, exercises, logs, achievements,
        activities, activitySessions] = await Promise.all([
        getSettings(supabase, userId),
        supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
        supabase
          .from("programs")
          .select("id, title, status, program_weeks ( program_modules ( module_items ( id, is_completed ) ) )")
          .eq("user_id", userId)
          .eq("status", "active")
          .order("sort_order", { ascending: true }),
        supabase.from("xp_events").select("amount, created_at").eq("user_id", userId),
        supabase
          .from("tasks")
          .select("duration_minutes")
          .eq("user_id", userId)
          .eq("is_completed", true)
          .gte("task_date", toDateKey(subDays(now, 120))),
        supabase.from("books").select("id, title, author, pages, current_page, status").eq("user_id", userId),
        supabase.from("exercises").select("id, title, score_max").eq("user_id", userId).eq("archived", false),
        supabase
          .from("exercise_logs")
          .select("exercise_id, duration_minutes, score, completed_at")
          .eq("user_id", userId)
          .order("completed_at", { ascending: false }),
        supabase.from("exercise_goal_achievements").select("id").eq("user_id", userId),
        supabase.from("activities").select("id,name,status").eq("user_id", userId),
        supabase.from("activity_sessions").select("activity_id,session_date,status,actual_minutes")
          .eq("user_id", userId),
      ]);
      for (const result of [profile, programs, xpAll, tasks, books, exercises, logs, activities, activitySessions]) throwIf(result.error);

      const totalXp = (xpAll.data ?? []).reduce((sum, e) => sum + e.amount, 0);
      const level = getLevelInfo(totalXp, { base: settings.level_base_xp, growth: Number(settings.level_growth) });
      type ProgramRow = { id: string; title: string; program_weeks: { program_modules: { module_items: { is_completed: boolean }[] }[] }[] };
      const programRows = (programs.data ?? []) as unknown as ProgramRow[];
      const overall = aggregateProgramsProgress(programRows);
      const logRows = logs.data ?? [];
      const weekAgo = subDays(now, 7);
      const lastWeek = logRows.filter((log) => new Date(log.completed_at) >= weekAgo);
      const exerciseById = new Map((exercises.data ?? []).map((e) => [e.id, e]));
      const taskMinutes = (tasks.data ?? []).reduce((sum, t) => sum + (t.duration_minutes ?? 0), 0);
      const exerciseMinutes = logRows.reduce((sum, l) => sum + l.duration_minutes, 0);
      const bookRows = books.data ?? [];

      return {
        display_name: profile.data?.display_name ?? null,
        today: toDateKey(now),
        xp: {
          total: totalXp,
          level: level.level,
          xp_in_level: level.currentLevelXp,
          xp_to_next_level: level.xpToNextLevel,
          level_progress_percent: percent(level.progress),
          last_14_days: bucketByDay(
            (xpAll.data ?? []).filter((e) => new Date(e.created_at) >= subDays(now, 14)),
            (e) => toDateKey(new Date(e.created_at)),
            (e) => e.amount,
            14,
          ).map(({ key, value }) => ({ date: key, xp: value })),
        },
        programs: {
          active_count: programRows.length,
          overall_progress: { ...overall, percent: percent(overall.progress) },
          active: programRows.map((program) => {
            const progress = computeProgramProgress(program);
            return {
              id: program.id,
              title: program.title,
              items_completed: progress.completed,
              items_total: progress.total,
              percent: percent(progress.progress),
            };
          }),
        },
        study_hours: round1((taskMinutes + exerciseMinutes) / 60),
        books: {
          completed: bookRows.filter((b) => b.status === "completed").length,
          to_read: bookRows.filter((b) => b.status === "to_read").length,
          reading: bookRows
            .filter((b) => b.status === "reading")
            .map((b) => ({
              id: b.id,
              title: b.title,
              author: b.author,
              current_page: b.current_page,
              pages: b.pages,
              percent: b.pages > 0 ? percent(b.current_page / b.pages) : null,
            })),
        },
        exercises: {
          active_count: exercises.data?.length ?? 0,
          total_minutes: exerciseMinutes,
          total_duration: formatDuration(exerciseMinutes),
          total_sessions: logRows.length,
          objectives_reached: achievements.error ? null : (achievements.data?.length ?? 0),
          last_7_days: {
            sessions: lastWeek.length,
            minutes: lastWeek.reduce((sum, log) => sum + log.duration_minutes, 0),
          },
          recent_sessions: logRows.slice(0, 10).map((log) => {
            const exercise = exerciseById.get(log.exercise_id);
            return {
              exercise_id: log.exercise_id,
              exercise: exercise?.title ?? null,
              completed_at: log.completed_at,
              duration_minutes: log.duration_minutes,
              score: log.score === null ? null : Number(log.score),
              score_max: exercise?.score_max ?? null,
            };
          }),
        },
        activities: {
          active_count: (activities.data ?? []).filter((activity) => activity.status === "active").length,
          total_sessions_done: (activitySessions.data ?? []).filter((session) => session.status === "done").length,
          total_hours_done: round1((activitySessions.data ?? []).filter((session) => session.status === "done")
            .reduce((sum, session) => sum + (session.actual_minutes ?? 0), 0) / 60),
          upcoming: (activitySessions.data ?? []).filter((session) =>
            session.status === "planned" && session.session_date >= todayInParis())
            .sort((a, b) => a.session_date.localeCompare(b.session_date))
            .slice(0, 10).map((session) => ({
              activity_id: session.activity_id,
              activity: (activities.data ?? []).find((activity) => activity.id === session.activity_id)?.name ?? null,
              date: session.session_date,
            })),
        },
      };
    },
  }),

  defineTool({
    name: "get_statistics",
    title: "Statistics",
    description:
      "Statistiques sur une fenetre glissante : XP par jour et par source, heures d'etude par semaine, sessions et " +
      "minutes d'exercice par semaine, bilan par exercice, livres termines par semaine.",
    kind: "read",
    input: {
      days: z.number().int().min(1).max(365).default(30).describe("Window for daily XP (default 30)"),
      weeks: z.number().int().min(1).max(104).default(12).describe("Window for weekly series (default 12)"),
    },
    handler: async ({ days, weeks }, { supabase, userId }) => {
      const now = new Date();
      const settings = await getSettings(supabase, userId);
      const startOfWeekDay = weekStartsOn(settings);
      const dailyStart = subDays(now, days);
      const weeklyStart = subWeeks(now, weeks);
      const since = dailyStart < weeklyStart ? dailyStart : weeklyStart;
      const sinceIso = since.toISOString();

      const [xp, logs, tasks, books, exercises] = await Promise.all([
        supabase.from("xp_events").select("created_at, amount, source").eq("user_id", userId).gte("created_at", sinceIso),
        supabase
          .from("exercise_logs")
          .select("exercise_id, completed_at, duration_minutes, score")
          .eq("user_id", userId)
          .gte("completed_at", sinceIso),
        supabase
          .from("tasks")
          .select("task_date, duration_minutes")
          .eq("user_id", userId)
          .eq("is_completed", true)
          .gte("task_date", toDateKey(since)),
        supabase
          .from("books")
          .select("completed_at")
          .eq("user_id", userId)
          .not("completed_at", "is", null)
          .gte("completed_at", sinceIso),
        supabase.from("exercises").select("id, title, score_max").eq("user_id", userId),
      ]);
      for (const result of [xp, logs, tasks, books, exercises]) throwIf(result.error);

      const xpRows = xp.data ?? [];
      const logRows = logs.data ?? [];
      const xpBySource: Record<string, number> = {};
      for (const event of xpRows) {
        if (new Date(event.created_at) < dailyStart) continue;
        xpBySource[event.source] = (xpBySource[event.source] ?? 0) + event.amount;
      }

      const weekly = <T>(items: T[], getDate: (item: T) => string, getValue: (item: T) => number) =>
        bucketByWeek(items, getDate, getValue, weeks, now, startOfWeekDay).map(({ key, value }) => ({
          week_start: key,
          value: round1(value),
        }));

      const durations = [
        ...(tasks.data ?? []).map((t) => ({ date: t.task_date, minutes: t.duration_minutes ?? 0 })),
        ...logRows.map((l) => ({ date: toDateKey(new Date(l.completed_at)), minutes: l.duration_minutes })),
      ];
      const weeklyLogs = logRows.filter((log) => new Date(log.completed_at) >= weeklyStart);
      const stats = groupExerciseStats(weeklyLogs);

      return {
        window: { days, weeks, week_starts_on: startOfWeekDay === 0 ? "sunday" : "monday" },
        xp_by_day: bucketByDay(
          xpRows.filter((e) => new Date(e.created_at) >= dailyStart),
          (e) => toDateKey(new Date(e.created_at)),
          (e) => e.amount,
          days,
        ).map(({ key, value }) => ({ date: key, xp: value })),
        xp_by_source: xpBySource,
        study_hours_by_week: weekly(durations, (d) => d.date, (d) => d.minutes / 60),
        exercise_sessions_by_week: weekly(weeklyLogs, (l) => toDateKey(new Date(l.completed_at)), () => 1),
        exercise_minutes_by_week: weekly(weeklyLogs, (l) => toDateKey(new Date(l.completed_at)), (l) => l.duration_minutes),
        exercises: (exercises.data ?? [])
          .filter((exercise) => stats.has(exercise.id))
          .map((exercise) => {
            const s = stats.get(exercise.id)!;
            return {
              exercise_id: exercise.id,
              title: exercise.title,
              sessions: s.count,
              minutes: s.totalMinutes,
              duration: formatDuration(s.totalMinutes),
              avg_score: s.avgScore,
              score_max: exercise.score_max,
            };
          }),
        books_completed_by_week: weekly(books.data ?? [], (b) => toDateKey(new Date(b.completed_at as string)), () => 1),
      };
    },
  }),

  defineTool({
    name: "list_xp_events",
    title: "List XP events",
    description:
      "Historique brut des gains d'XP (XP total = somme des montants). Filtres : periode, source " +
      "(exercise = session d'exercice, book = livre termine, task = element de programme coche).",
    kind: "read",
    input: {
      since: timestamp.optional(),
      until: timestamp.optional(),
      source: z.enum(XP_SOURCES).optional(),
      limit: limit(100, 1000),
    },
    handler: async ({ since, until, source, limit: max }, { supabase, userId }) => {
      let query = supabase
        .from("xp_events")
        .select("id, source, ref_id, amount, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(max);
      if (since) query = query.gte("created_at", new Date(since).toISOString());
      if (until) query = query.lte("created_at", new Date(until).toISOString());
      if (source) query = query.eq("source", source);

      const { data, error } = await query;
      throwIf(error);
      const events = data ?? [];
      return { count: events.length, total_amount: events.reduce((sum, e) => sum + e.amount, 0), events };
    },
  }),

  defineTool({
    name: "search",
    title: "Search",
    description:
      "Recherche plein texte (insensible a la casse) dans les programmes, leurs elements (lecons, objectifs...), " +
      "les livres (titre, auteur, notes) et les exercices. Renvoie les ids a utiliser avec les autres outils.",
    kind: "read",
    input: {
      query: z.string().min(1).max(200).describe("Text to look for"),
    },
    handler: async ({ query }, { supabase, userId }) => {
      const needle = query.toLocaleLowerCase("fr");
      const matches = (...values: (string | null | undefined)[]) =>
        values.some((value) => value?.toLocaleLowerCase("fr").includes(needle));

      const [programs, books, exercises, activities] = await Promise.all([
        supabase
          .from("programs")
          .select(
            "id, title, description, status, program_weeks ( id, week_number, title, program_modules ( id, title, module_items ( id, type, title, description, is_completed ) ) )",
          )
          .eq("user_id", userId),
        supabase.from("books").select("id, title, author, notes, status").eq("user_id", userId),
        supabase.from("exercises").select("id, title, description, archived").eq("user_id", userId),
        supabase.from("activities").select("id,name,description,status,kind,place,organizer")
          .eq("user_id", userId),
      ]);
      for (const result of [programs, books, exercises, activities]) throwIf(result.error);

      type Item = { id: string; type: string; title: string; description: string; is_completed: boolean };
      type Program = {
        id: string;
        title: string;
        description: string;
        status: string;
        program_weeks: { id: string; week_number: number; title: string; program_modules: { id: string; title: string; module_items: Item[] }[] }[];
      };
      const programRows = (programs.data ?? []) as unknown as Program[];

      const programItems = programRows.flatMap((program) =>
        program.program_weeks.flatMap((week) =>
          week.program_modules.flatMap((module) =>
            module.module_items
              .filter((item) => matches(item.title, item.description))
              .map((item) => ({
                item_id: item.id,
                type: item.type,
                title: item.title,
                is_completed: item.is_completed,
                program_id: program.id,
                program: program.title,
                week_id: week.id,
                week_number: week.week_number,
                module_id: module.id,
                module: module.title,
              })),
          ),
        ),
      );

      return {
        programs: programRows
          .filter((p) => matches(p.title, p.description))
          .map((p) => ({ id: p.id, title: p.title, status: p.status })),
        program_items: programItems,
        program_modules: programRows.flatMap((program) =>
          program.program_weeks.flatMap((week) =>
            week.program_modules
              .filter((module) => matches(module.title))
              .map((module) => ({ module_id: module.id, title: module.title, program_id: program.id, week_id: week.id })),
          ),
        ),
        books: (books.data ?? [])
          .filter((b) => matches(b.title, b.author, b.notes))
          .map((b) => ({ id: b.id, title: b.title, author: b.author, status: b.status })),
        exercises: (exercises.data ?? [])
          .filter((e) => matches(e.title, e.description))
          .map((e) => ({ id: e.id, title: e.title, archived: e.archived })),
        activities: (activities.data ?? [])
          .filter((activity) => matches(activity.name, activity.description, activity.place, activity.organizer))
          .map((activity) => ({ id: activity.id, name: activity.name, status: activity.status, kind: activity.kind })),
      };
    },
  }),
];
