import { z } from "zod";
import { confirm, dateKey, defineTool, definedOnly, id, limit, throwIf, timestamp } from "./define.js";
import { ownedExercise, ownedExerciseGoal, ownedExerciseLog, resolveCategoryId } from "./ownership.js";
import { badRequest } from "./result.js";
import type { ToolContext } from "../context.js";
import type { ExerciseGoalPeriod, ExerciseGoalType, Tables } from "../domain/database.js";
import { formatDuration } from "../domain/date.js";
import { describeGoal, describeRemaining } from "../domain/exercise-goal-labels.js";
import {
  computeExerciseGoalProgress,
  groupExerciseStats,
  normalizeExerciseGoalDrafts,
  pickNextGoal,
  type ExerciseGoalProgress,
} from "../domain/exercises.js";
import { isMissingTableError } from "../services/errors.js";
import { recordGoalAchievements } from "../services/exercise-achievements.js";
import { replaceExerciseGoals } from "../services/exercise-goals-sync.js";
import { getSettings, weekStartsOn } from "../services/settings.js";
import { awardXp, revokeXp } from "../services/xp-award.js";

const GOAL_TYPES = ["sessions", "minutes", "score"] as const satisfies readonly ExerciseGoalType[];
const GOAL_PERIODS = ["total", "week", "month"] as const satisfies readonly ExerciseGoalPeriod[];

const goalInput = z.object({
  id: id("Existing objective").optional().describe("Keep an existing objective (update it) instead of creating one"),
  type: z.enum(GOAL_TYPES).describe("sessions = number of sessions, minutes = total minutes, score = average score"),
  target: z.number().positive().describe("Target value (score is on the exercise's score_max scale)"),
  period: z.enum(GOAL_PERIODS).default("total").describe("total = all time, week = current week, month = current month"),
  deadline: dateKey.nullable().optional(),
});

const scoreMax = z.number().int().min(1).max(1_000_000).describe("Scale sessions are scored on: 5, 10, 20, 30, 100…");

type LogRow = Pick<Tables<"exercise_logs">, "id" | "exercise_id" | "duration_minutes" | "score" | "notes" | "completed_at">;
type AchievementRow = Tables<"exercise_goal_achievements">;

// ------------------------------------------------------------------ helpers

async function loadGoalData(ctx: ToolContext, exerciseId?: string) {
  let goalsQuery = ctx.supabase
    .from("exercise_goals")
    .select("*")
    .eq("user_id", ctx.userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  let achievementsQuery = ctx.supabase
    .from("exercise_goal_achievements")
    .select("*")
    .eq("user_id", ctx.userId)
    .order("reached_at", { ascending: false });
  if (exerciseId) {
    goalsQuery = goalsQuery.eq("exercise_id", exerciseId);
    achievementsQuery = achievementsQuery.eq("exercise_id", exerciseId);
  }

  const [goals, achievements] = await Promise.all([goalsQuery, achievementsQuery]);
  // Before the objectives migration is applied, behave as if there were none.
  const soft = <T>(result: { data: T[] | null; error: { code?: string } | null }) => {
    if (result.error && !isMissingTableError(result.error)) throw result.error;
    return result.data ?? [];
  };
  return { goals: soft(goals), achievements: soft(achievements) as AchievementRow[] };
}

function presentGoal(goal: ExerciseGoalProgress, exerciseScoreMax: number) {
  return {
    id: goal.id,
    label: describeGoal(goal, exerciseScoreMax),
    type: goal.type,
    target: goal.target,
    period: goal.period,
    period_start: goal.periodStart,
    deadline: goal.deadline,
    days_left: goal.daysLeft,
    current: goal.type === "score" && goal.sampleSize === 0 ? null : goal.current,
    percent: Math.round(goal.progress * 100),
    remaining: goal.remaining,
    remaining_label: goal.reached ? null : describeRemaining(goal.type, goal.remaining),
    status: goal.status,
  };
}

function presentAchievement(achievement: AchievementRow, exerciseScoreMax: number) {
  return {
    id: achievement.id,
    label: describeGoal(achievement, exerciseScoreMax),
    goal_id: achievement.goal_id,
    log_id: achievement.log_id,
    type: achievement.type,
    target: Number(achievement.target),
    period: achievement.period,
    period_key: achievement.period_key,
    value_before: Number(achievement.value_before),
    value_after: Number(achievement.value_after),
    reached_at: achievement.reached_at,
  };
}

function presentLog(log: LogRow, milestones: AchievementRow[], exerciseScoreMax: number) {
  return {
    id: log.id,
    completed_at: log.completed_at,
    duration_minutes: log.duration_minutes,
    score: log.score === null ? null : Number(log.score),
    score_max: exerciseScoreMax,
    notes: log.notes,
    milestones: milestones.map((m) => describeGoal(m, exerciseScoreMax)),
  };
}

async function exerciseSummary(
  ctx: ToolContext,
  exercises: Tables<"exercises">[],
  options: { withLogs?: number } = {},
) {
  const ids = exercises.map((e) => e.id);
  if (ids.length === 0) return [];

  const [logsResult, settings, { goals, achievements }] = await Promise.all([
    ctx.supabase
      .from("exercise_logs")
      .select("id, exercise_id, duration_minutes, score, notes, completed_at")
      .eq("user_id", ctx.userId)
      .in("exercise_id", ids)
      .order("completed_at", { ascending: false }),
    getSettings(ctx.supabase, ctx.userId),
    loadGoalData(ctx, ids.length === 1 ? ids[0] : undefined),
  ]);
  throwIf(logsResult.error);
  const logs = (logsResult.data ?? []) as LogRow[];
  const stats = groupExerciseStats(logs);
  const now = new Date();

  return exercises.map((exercise) => {
    const exerciseLogs = logs.filter((log) => log.exercise_id === exercise.id);
    const progress = goals
      .filter((goal) => goal.exercise_id === exercise.id)
      .map((goal) => computeExerciseGoalProgress(goal, exerciseLogs, now, weekStartsOn(settings)));
    const next = pickNextGoal(progress);
    const exerciseAchievements = achievements.filter((a) => a.exercise_id === exercise.id);
    const s = stats.get(exercise.id) ?? { count: 0, totalMinutes: 0, avgScore: null };

    return {
      id: exercise.id,
      title: exercise.title,
      description: exercise.description,
      category_id: exercise.category_id,
      xp_value: exercise.xp_value,
      score_max: exercise.score_max,
      archived: exercise.archived,
      created_at: exercise.created_at,
      stats: {
        sessions: s.count,
        total_minutes: s.totalMinutes,
        total_duration: formatDuration(s.totalMinutes),
        avg_score: s.avgScore,
        avg_score_label: s.avgScore === null ? null : `${s.avgScore} / ${exercise.score_max}`,
        last_session_at: exerciseLogs[0]?.completed_at ?? null,
      },
      next_objective: next ? presentGoal(next, exercise.score_max) : null,
      objectives: progress.map((goal) => presentGoal(goal, exercise.score_max)),
      objectives_reached: progress.filter((goal) => goal.reached).length,
      milestones: exerciseAchievements.map((a) => presentAchievement(a, exercise.score_max)),
      ...(options.withLogs
        ? {
            sessions: exerciseLogs.slice(0, options.withLogs).map((log) =>
              presentLog(
                log,
                exerciseAchievements.filter((a) => a.log_id === log.id),
                exercise.score_max,
              ),
            ),
          }
        : {}),
    };
  });
}

function parseScore(score: number | null | undefined, exerciseScoreMax: number) {
  if (score === undefined || score === null) return score;
  if (score > exerciseScoreMax) badRequest(`Score ${score} is above this exercise's scale (/${exerciseScoreMax})`);
  return score;
}

// -------------------------------------------------------------------- tools

export const exerciseTools = [
  defineTool({
    name: "list_exercises",
    title: "List exercises",
    description:
      "Liste les exercices (pratique deliberee) avec pour chacun : sessions, minutes totales (et en heures), score moyen " +
      "sur son echelle (ex. 6.2 / 10), derniere session, prochain objectif, tous les objectifs avec progression/statut, " +
      "et milestones atteints.",
    kind: "read",
    input: {
      include_archived: z.boolean().default(false),
      category_id: id("Category").optional(),
    },
    handler: async ({ include_archived, category_id }, ctx) => {
      let query = ctx.supabase
        .from("exercises")
        .select("*")
        .eq("user_id", ctx.userId)
        .order("created_at", { ascending: false });
      if (!include_archived) query = query.eq("archived", false);
      if (category_id) query = query.eq("category_id", category_id);
      const { data, error } = await query;
      throwIf(error);
      return exerciseSummary(ctx, data ?? []);
    },
  }),

  defineTool({
    name: "get_exercise",
    title: "Get exercise",
    description:
      "Tableau de bord d'un exercice : stats, prochain objectif, objectifs (progression actuelle/cible, %, reste, statut), " +
      "milestones valides, et historique des sessions (avec les milestones atteints par chaque session).",
    kind: "read",
    input: {
      exercise_id: id("Exercise"),
      sessions_limit: limit(50, 1000),
    },
    handler: async ({ exercise_id, sessions_limit }, ctx) => {
      const exercise = await ownedExercise(ctx, exercise_id);
      const [summary] = await exerciseSummary(ctx, [exercise], { withLogs: sessions_limit });
      return summary;
    },
  }),

  defineTool({
    name: "create_exercise",
    title: "Create exercise",
    description:
      "Cree un exercice. score_max = echelle des scores (5, 10, 20, 30, 100...). `objectives` cree directement " +
      "autant d'objectifs que voulu.",
    kind: "write",
    input: {
      title: z.string().trim().min(1).max(200),
      description: z.string().max(20000).optional(),
      category_id: id("Category").nullable().optional(),
      xp_value: z.number().int().min(0).max(100000).optional().describe("XP per session (default from settings)"),
      score_max: scoreMax.optional().describe("Default 10"),
      objectives: z.array(goalInput.omit({ id: true })).max(100).optional(),
    },
    handler: async ({ objectives, category_id, xp_value, score_max, ...fields }, ctx) => {
      const categoryId = await resolveCategoryId(ctx, category_id);
      const settings = await getSettings(ctx.supabase, ctx.userId);
      const { data, error } = await ctx.supabase
        .from("exercises")
        .insert({
          user_id: ctx.userId,
          title: fields.title,
          description: fields.description ?? "",
          category_id: categoryId ?? null,
          xp_value: xp_value ?? settings.default_exercise_xp,
          score_max: score_max ?? 10,
        })
        .select()
        .single();
      throwIf(error);
      if (objectives?.length) {
        await replaceExerciseGoals(ctx.supabase, ctx.userId, data!.id, normalizeExerciseGoalDrafts(objectives));
      }
      const [summary] = await exerciseSummary(ctx, [data!]);
      return { created: summary };
    },
  }),

  defineTool({
    name: "update_exercise",
    title: "Update exercise",
    description:
      "Modifie un exercice (seuls les champs fournis changent) : titre, description, categorie, XP par session, " +
      "echelle du score (score_max), archivage (archived=true le masque sans rien supprimer).",
    kind: "write",
    input: {
      exercise_id: id("Exercise"),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(20000).optional(),
      category_id: id("Category").nullable().optional(),
      xp_value: z.number().int().min(0).max(100000).optional(),
      score_max: scoreMax.optional(),
      archived: z.boolean().optional(),
    },
    handler: async ({ exercise_id, category_id, ...values }, ctx) => {
      await ownedExercise(ctx, exercise_id);
      const categoryId = await resolveCategoryId(ctx, category_id);
      const update = definedOnly({ ...values, category_id: categoryId });
      if (Object.keys(update).length === 0) badRequest("Nothing to update");
      const { data, error } = await ctx.supabase
        .from("exercises")
        .update(update)
        .eq("id", exercise_id)
        .eq("user_id", ctx.userId)
        .select()
        .single();
      throwIf(error);
      const [summary] = await exerciseSummary(ctx, [data!]);
      return { updated: summary };
    },
  }),

  defineTool({
    name: "list_exercise_sessions",
    title: "List exercise sessions",
    description: "Sessions d'exercice (tous exercices ou un seul), filtrables par periode, les plus recentes d'abord.",
    kind: "read",
    input: {
      exercise_id: id("Exercise").optional(),
      since: timestamp.optional(),
      until: timestamp.optional(),
      limit: limit(100, 2000),
    },
    handler: async ({ exercise_id, since, until, limit: max }, ctx) => {
      let query = ctx.supabase
        .from("exercise_logs")
        .select("id, exercise_id, duration_minutes, score, notes, completed_at, exercises ( title, score_max )")
        .eq("user_id", ctx.userId)
        .order("completed_at", { ascending: false })
        .limit(max);
      if (exercise_id) query = query.eq("exercise_id", exercise_id);
      if (since) query = query.gte("completed_at", new Date(since).toISOString());
      if (until) query = query.lte("completed_at", new Date(until).toISOString());
      const { data, error } = await query;
      throwIf(error);

      const { achievements } = await loadGoalData(ctx, exercise_id);
      type Row = LogRow & { exercises: { title: string; score_max: number } | null };
      const rows = (data ?? []) as unknown as Row[];
      const minutes = rows.reduce((sum, r) => sum + r.duration_minutes, 0);
      return {
        count: rows.length,
        total_minutes: minutes,
        total_duration: formatDuration(minutes),
        sessions: rows.map(({ exercises, ...log }) => ({
          ...presentLog(
            log,
            achievements.filter((a) => a.log_id === log.id),
            exercises?.score_max ?? 10,
          ),
          exercise_id: log.exercise_id,
          exercise: exercises?.title ?? null,
        })),
      };
    },
  }),

  defineTool({
    name: "log_exercise_session",
    title: "Log exercise session",
    description:
      "Enregistre une session d'exercice : accorde l'XP de l'exercice et enregistre les objectifs franchis pour la " +
      "premiere fois par cette session (renvoyes dans `objectives_reached`). completed_at permet d'antidater.",
    kind: "write",
    input: {
      exercise_id: id("Exercise"),
      duration_minutes: z.number().int().min(0).max(100000).default(0),
      score: z.number().min(0).nullable().optional().describe("On the exercise's score_max scale"),
      notes: z.string().max(50000).optional(),
      completed_at: timestamp.optional().describe("Defaults to now"),
    },
    handler: async ({ exercise_id, duration_minutes, score, notes, completed_at }, ctx) => {
      const exercise = await ownedExercise(ctx, exercise_id);
      const { data: log, error } = await ctx.supabase
        .from("exercise_logs")
        .insert({
          exercise_id,
          user_id: ctx.userId,
          duration_minutes,
          score: parseScore(score, exercise.score_max) ?? null,
          notes: notes ?? "",
          ...(completed_at ? { completed_at: new Date(completed_at).toISOString() } : {}),
        })
        .select()
        .single();
      throwIf(error);

      await awardXp(ctx.supabase, ctx.userId, "exercise", log!.id, exercise.xp_value);
      const reached = await recordGoalAchievements(ctx.supabase, ctx.userId, exercise_id, log!.id);
      const [summary] = await exerciseSummary(ctx, [exercise]);

      return {
        session: presentLog(log!, reached, exercise.score_max),
        xp_awarded: exercise.xp_value,
        objectives_reached: reached.map((a) => presentAchievement(a, exercise.score_max)),
        exercise: summary,
      };
    },
  }),

  defineTool({
    name: "update_exercise_session",
    title: "Update exercise session",
    description: "Corrige une session (duree, score, notes, date). score=null efface le score.",
    kind: "write",
    input: {
      session_id: id("Exercise session"),
      duration_minutes: z.number().int().min(0).max(100000).optional(),
      score: z.number().min(0).nullable().optional(),
      notes: z.string().max(50000).optional(),
      completed_at: timestamp.optional(),
    },
    handler: async ({ session_id, score, completed_at, ...values }, ctx) => {
      const log = await ownedExerciseLog(ctx, session_id);
      const exercise = await ownedExercise(ctx, log.exercise_id);
      const update = definedOnly({
        ...values,
        score: parseScore(score, exercise.score_max),
        completed_at: completed_at ? new Date(completed_at).toISOString() : undefined,
      });
      if (Object.keys(update).length === 0) badRequest("Nothing to update");
      const { data, error } = await ctx.supabase
        .from("exercise_logs")
        .update(update)
        .eq("id", session_id)
        .eq("user_id", ctx.userId)
        .select()
        .single();
      throwIf(error);
      return { updated: presentLog(data!, [], exercise.score_max) };
    },
  }),

  defineTool({
    name: "delete_exercise_session",
    title: "Delete exercise session",
    description:
      "Supprime DEFINITIVEMENT une session et retire l'XP qu'elle avait rapportee. Les milestones deja valides restent.",
    kind: "delete",
    input: { session_id: id("Exercise session"), confirm },
    handler: async ({ session_id }, ctx) => {
      const log = await ownedExerciseLog(ctx, session_id);
      await revokeXp(ctx.supabase, ctx.userId, "exercise", session_id);
      const { error } = await ctx.supabase.from("exercise_logs").delete().eq("id", session_id).eq("user_id", ctx.userId);
      throwIf(error);
      return { deleted: { id: log.id, completed_at: log.completed_at, duration_minutes: log.duration_minutes } };
    },
  }),

  defineTool({
    name: "add_exercise_objectives",
    title: "Add exercise objectives",
    description:
      "Ajoute un ou plusieurs objectifs a un exercice (sans toucher aux existants). Types : sessions, minutes, score " +
      "(score moyen sur l'echelle de l'exercice). Periode : total, week, month. Echeance optionnelle.",
    kind: "write",
    input: {
      exercise_id: id("Exercise"),
      objectives: z.array(goalInput.omit({ id: true })).min(1).max(100),
    },
    handler: async ({ exercise_id, objectives }, ctx) => {
      const exercise = await ownedExercise(ctx, exercise_id);
      const { goals } = await loadGoalData(ctx, exercise_id);
      const drafts = [
        ...goals.map((goal) => ({ id: goal.id, type: goal.type, target: goal.target, period: goal.period, deadline: goal.deadline })),
        ...objectives,
      ];
      await replaceExerciseGoals(ctx.supabase, ctx.userId, exercise_id, normalizeExerciseGoalDrafts(drafts));
      const [summary] = await exerciseSummary(ctx, [exercise]);
      return { objectives: summary.objectives };
    },
  }),

  defineTool({
    name: "set_exercise_objectives",
    title: "Replace exercise objectives",
    description:
      "Remplace la liste complete des objectifs d'un exercice, dans l'ordre donne. Inclure `id` pour conserver un " +
      "objectif existant ; un objectif absent de la liste est supprime (ses milestones deja atteints restent).",
    kind: "write",
    input: {
      exercise_id: id("Exercise"),
      objectives: z.array(goalInput).max(100),
    },
    handler: async ({ exercise_id, objectives }, ctx) => {
      const exercise = await ownedExercise(ctx, exercise_id);
      await replaceExerciseGoals(ctx.supabase, ctx.userId, exercise_id, normalizeExerciseGoalDrafts(objectives));
      const [summary] = await exerciseSummary(ctx, [exercise]);
      return { objectives: summary.objectives };
    },
  }),

  defineTool({
    name: "update_exercise_objective",
    title: "Update exercise objective",
    description: "Modifie un objectif (type, cible, periode, echeance ; deadline=null l'efface).",
    kind: "write",
    input: {
      objective_id: id("Objective"),
      type: z.enum(GOAL_TYPES).optional(),
      target: z.number().positive().optional(),
      period: z.enum(GOAL_PERIODS).optional(),
      deadline: dateKey.nullable().optional(),
    },
    handler: async ({ objective_id, ...values }, ctx) => {
      await ownedExerciseGoal(ctx, objective_id);
      const update = definedOnly(values);
      if (Object.keys(update).length === 0) badRequest("Nothing to update");
      const { data, error } = await ctx.supabase
        .from("exercise_goals")
        .update(update)
        .eq("id", objective_id)
        .eq("user_id", ctx.userId)
        .select()
        .single();
      throwIf(error);
      return { updated: data };
    },
  }),

  defineTool({
    name: "delete_exercise_objective",
    title: "Delete exercise objective",
    description: "Supprime DEFINITIVEMENT un objectif. Les milestones qu'il a deja valides restent dans l'historique.",
    kind: "delete",
    input: { objective_id: id("Objective"), confirm },
    handler: async ({ objective_id }, ctx) => {
      const goal = await ownedExerciseGoal(ctx, objective_id);
      const { error } = await ctx.supabase.from("exercise_goals").delete().eq("id", objective_id).eq("user_id", ctx.userId);
      throwIf(error);
      return { deleted: { id: goal.id, type: goal.type, target: Number(goal.target), period: goal.period } };
    },
  }),

  defineTool({
    name: "list_milestones",
    title: "List milestones",
    description: "Tous les objectifs d'exercice atteints (milestones), du plus recent au plus ancien, avec la session qui les a valides.",
    kind: "read",
    input: { exercise_id: id("Exercise").optional() },
    handler: async ({ exercise_id }, ctx) => {
      if (exercise_id) await ownedExercise(ctx, exercise_id);
      const [{ achievements }, exercises] = await Promise.all([
        loadGoalData(ctx, exercise_id),
        ctx.supabase.from("exercises").select("id, title, score_max").eq("user_id", ctx.userId),
      ]);
      throwIf(exercises.error);
      const byId = new Map((exercises.data ?? []).map((e) => [e.id, e]));
      return achievements.map((achievement) => {
        const exercise = byId.get(achievement.exercise_id);
        return {
          ...presentAchievement(achievement, exercise?.score_max ?? 10),
          exercise_id: achievement.exercise_id,
          exercise: exercise?.title ?? null,
        };
      });
    },
  }),
];
