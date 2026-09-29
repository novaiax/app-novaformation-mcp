// Ported from the NovaFormation app (src/lib/exercises.ts) — keep both in sync.
import { differenceInCalendarDays, parseISO } from "date-fns";
import type { ExerciseGoalPeriod, ExerciseGoalType } from "./database.js";

export interface ExerciseLogStatsInput {
  exercise_id: string;
  duration_minutes: number;
  score: number | null;
}

export interface ExerciseStats {
  count: number;
  totalMinutes: number;
  avgScore: number | null;
}

const EMPTY_STATS: ExerciseStats = { count: 0, totalMinutes: 0, avgScore: null };

/** Groups logs per exercise into aggregate stats — one pass instead of filtering per card. */
export function groupExerciseStats(logs: ExerciseLogStatsInput[]): Map<string, ExerciseStats> {
  const byExercise = new Map<string, ExerciseLogStatsInput[]>();
  for (const log of logs) {
    if (!byExercise.has(log.exercise_id)) byExercise.set(log.exercise_id, []);
    byExercise.get(log.exercise_id)!.push(log);
  }

  const stats = new Map<string, ExerciseStats>();
  for (const [exerciseId, entries] of byExercise) {
    const totalMinutes = entries.reduce((sum, l) => sum + l.duration_minutes, 0);
    const scored = entries.filter((l): l is ExerciseLogStatsInput & { score: number } => l.score !== null);
    // Postgres `numeric` columns come back from PostgREST as strings (avoids float
    // precision loss), so `l.score` is a string at runtime despite the `number` type —
    // `sum + l.score` would silently string-concatenate instead of adding. Coerce explicitly.
    const avgScore =
      scored.length > 0
        ? Math.round((scored.reduce((sum, l) => sum + Number(l.score), 0) / scored.length) * 10) / 10
        : null;
    stats.set(exerciseId, { count: entries.length, totalMinutes, avgScore });
  }

  return stats;
}

export function getExerciseStats(
  statsByExercise: Map<string, ExerciseStats>,
  exerciseId: string,
): ExerciseStats {
  return statsByExercise.get(exerciseId) ?? EMPTY_STATS;
}

// ------------------------------------------------------------------- goals

export const EXERCISE_GOAL_TYPES: ExerciseGoalType[] = ["sessions", "minutes", "score"];
export const EXERCISE_GOAL_PERIODS: ExerciseGoalPeriod[] = ["total", "week", "month"];

export interface ExerciseGoalInput {
  id: string;
  type: ExerciseGoalType;
  target: number;
  period: ExerciseGoalPeriod;
  deadline: string | null;
}

export interface ExerciseGoalLogInput {
  duration_minutes: number;
  score: number | null;
  completed_at: string;
}

/** in_progress → near (≥ NEAR_GOAL_RATIO of the target) → reached. */
export type ExerciseGoalStatus = "in_progress" | "near" | "reached";

export const NEAR_GOAL_RATIO = 0.8;

const PARIS_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
});

function parisDateKey(date: Date): string {
  const parts = Object.fromEntries(PARIS_DATE.formatToParts(date).map((part) => [part.type, part.value]));
  return parts.year + "-" + parts.month + "-" + parts.day;
}

/** Stable week/month key across the MCP, browser and PostgreSQL. */
export function exerciseGoalPeriodKey(
  period: ExerciseGoalPeriod,
  date: Date,
  weekStartsOn: 0 | 1 = 1,
): string {
  if (period === "total") return "total";
  const dateKey = parisDateKey(date);
  if (period === "month") return dateKey.slice(0, 7) + "-01";
  const [year, month, day] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() - (utc.getUTCDay() - weekStartsOn + 7) % 7);
  return utc.toISOString().slice(0, 10);
}

export interface ExerciseGoalProgress extends ExerciseGoalInput {
  /** First day counted (yyyy-MM-dd), null for an all-time objective. */
  periodStart: string | null;
  /** "total", or periodStart — identifies the period an achievement belongs to. */
  periodKey: string;
  /** Sessions count, total minutes, or average score (0 with no scored session yet). */
  current: number;
  /** 0..1, capped. */
  progress: number;
  /** How much is still missing (0 once reached). */
  remaining: number;
  reached: boolean;
  status: ExerciseGoalStatus;
  /** Sessions counted in the period (for a score objective: sessions that have a score). */
  sampleSize: number;
  /** Calendar days until the deadline (negative once passed), null without a deadline. */
  daysLeft: number | null;
}

// Same `numeric`-comes-back-as-string caveat as groupExerciseStats.
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Progress of one objective, counting only the sessions inside its period. */
export function computeExerciseGoalProgress(
  goal: ExerciseGoalInput,
  logs: ExerciseGoalLogInput[],
  referenceDate: Date = new Date(),
  weekStartsOn: 0 | 1 = 1,
): ExerciseGoalProgress {
  const target = toNumberOrNull(goal.target) ?? 0;
  const periodStart = goal.period === "total" ? null : exerciseGoalPeriodKey(goal.period, referenceDate, weekStartsOn);
  const referenceKey = parisDateKey(referenceDate);
  const inPeriod = periodStart
    ? logs.filter((log) => {
      const dateKey = parisDateKey(new Date(log.completed_at));
      return dateKey >= periodStart && dateKey <= referenceKey;
    })
    : logs;

  let current: number;
  let sampleSize = inPeriod.length;
  if (goal.type === "sessions") {
    current = inPeriod.length;
  } else if (goal.type === "minutes") {
    current = inPeriod.reduce((sum, log) => sum + Number(log.duration_minutes), 0);
  } else {
    const scores = inPeriod
      .map((log) => toNumberOrNull(log.score))
      .filter((score): score is number => score !== null);
    sampleSize = scores.length;
    current =
      scores.length > 0 ? Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10) / 10 : 0;
  }

  const progress = target > 0 ? Math.min(1, current / target) : 0;
  const reached = sampleSize > 0 && current >= target;

  return {
    id: goal.id,
    type: goal.type,
    target,
    period: goal.period,
    deadline: goal.deadline,
    periodStart,
    periodKey: periodStart ?? "total",
    current,
    progress,
    remaining: reached ? 0 : Math.round(Math.max(0, target - current) * 10) / 10,
    reached,
    status: reached ? "reached" : progress >= NEAR_GOAL_RATIO ? "near" : "in_progress",
    sampleSize,
    daysLeft: goal.deadline ? differenceInCalendarDays(parseISO(goal.deadline), parseISO(referenceKey)) : null,
  };
}

/** The objective to push next: the unreached one closest to done, earliest deadline breaking ties. */
export function pickNextGoal(goals: ExerciseGoalProgress[]): ExerciseGoalProgress | null {
  const open = goals.filter((goal) => !goal.reached);
  if (open.length === 0) return null;

  return open.reduce((best, goal) => {
    if (goal.progress !== best.progress) return goal.progress > best.progress ? goal : best;
    if (goal.deadline && (!best.deadline || goal.deadline < best.deadline)) return goal;
    return best;
  });
}

export interface ExerciseGoalCrossing {
  goal: ExerciseGoalInput;
  periodKey: string;
  before: number;
  after: number;
}

/**
 * Objectives a new session pushed over their target: `before < target <= after`,
 * measured in the same period. An objective already reached before the session is
 * never returned, so later sessions can't cross it again (the database unique key
 * on achievements backs this up across requests).
 */
export function detectGoalCrossings(
  goals: ExerciseGoalInput[],
  logsBefore: ExerciseGoalLogInput[],
  logsAfter: ExerciseGoalLogInput[],
  referenceDate: Date = new Date(),
  weekStartsOn: 0 | 1 = 1,
): ExerciseGoalCrossing[] {
  const crossings: ExerciseGoalCrossing[] = [];
  for (const goal of goals) {
    const before = computeExerciseGoalProgress(goal, logsBefore, referenceDate, weekStartsOn);
    const after = computeExerciseGoalProgress(goal, logsAfter, referenceDate, weekStartsOn);
    if (!before.reached && after.reached) {
      crossings.push({ goal, periodKey: after.periodKey, before: before.current, after: after.current });
    }
  }
  return crossings;
}

export interface ExerciseGoalDraft {
  id?: string;
  type: ExerciseGoalType;
  target: number;
  period: ExerciseGoalPeriod;
  deadline: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Validates untrusted objective rows (form JSON or MCP input); rows without a positive target are dropped. */
export function normalizeExerciseGoalDrafts(raw: unknown): ExerciseGoalDraft[] {
  if (!Array.isArray(raw)) return [];

  const drafts: ExerciseGoalDraft[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const type = row.type as ExerciseGoalType;
    const target = toNumberOrNull(row.target);
    if (!EXERCISE_GOAL_TYPES.includes(type) || target === null || target <= 0) continue;

    const period = EXERCISE_GOAL_PERIODS.includes(row.period as ExerciseGoalPeriod)
      ? (row.period as ExerciseGoalPeriod)
      : "total";
    const deadline = typeof row.deadline === "string" && DATE_PATTERN.test(row.deadline) ? row.deadline : null;
    const id = typeof row.id === "string" && UUID_PATTERN.test(row.id) ? row.id : undefined;

    drafts.push({ ...(id ? { id } : {}), type, target, period, deadline });
  }
  return drafts;
}
