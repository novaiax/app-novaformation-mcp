// Ported from the NovaFormation app (src/lib/exercise-goal-labels.ts) — keep both in sync.
import { formatDuration } from "./date.js";
import type { ExerciseGoalPeriod, ExerciseGoalType } from "./database.js";

const PERIOD_SUFFIX: Record<ExerciseGoalPeriod, string> = {
  total: "",
  week: " cette semaine",
  month: " ce mois-ci",
};

export const GOAL_PERIOD_LABELS: Record<ExerciseGoalPeriod, string> = {
  total: "Au total",
  week: "Par semaine",
  month: "Par mois",
};

export const GOAL_TYPE_LABELS: Record<ExerciseGoalType, string> = {
  score: "Score moyen",
  minutes: "Minutes",
  sessions: "Sessions",
};

function plural(count: number, word: string) {
  return `${count} ${word}${count > 1 ? "s" : ""}`;
}

/** "1000 minutes de pratique", "20 sessions cette semaine", "Score moyen de 7 / 10". */
export function describeGoal(
  goal: { type: ExerciseGoalType; target: number; period: ExerciseGoalPeriod },
  scoreMax: number,
): string {
  const target = Number(goal.target);
  const suffix = PERIOD_SUFFIX[goal.period];
  if (goal.type === "minutes") return `${plural(target, "minute")} de pratique${suffix}`;
  if (goal.type === "sessions") return `${plural(target, "session")}${suffix}`;
  return `Score moyen de ${target} / ${scoreMax}${suffix}`;
}

/** A goal quantity with its unit: "1055 min", "12 sessions", "6.8 / 10". */
export function formatGoalValue(type: ExerciseGoalType, value: number, scoreMax: number): string {
  const rounded = Math.round(Number(value) * 10) / 10;
  if (type === "minutes") return `${rounded} min`;
  if (type === "sessions") return plural(rounded, "session");
  return `${rounded} / ${scoreMax}`;
}

/** The right-hand side of "current / target": "1000 min", "20 sessions", "7 (sur 10)". */
export function formatGoalTarget(type: ExerciseGoalType, target: number, scoreMax: number): string {
  const rounded = Math.round(Number(target) * 10) / 10;
  if (type === "score") return `${rounded} (sur ${scoreMax})`;
  return formatGoalValue(type, rounded, scoreMax);
}

/** What is still missing: "Plus que 45 min (…)", "Plus que 3 sessions", "Plus que 0.4 point". */
export function describeRemaining(type: ExerciseGoalType, remaining: number): string {
  const rounded = Math.round(remaining * 10) / 10;
  if (type === "minutes") {
    return rounded >= 60 ? `Plus que ${formatDuration(rounded)}` : `Plus que ${rounded} min`;
  }
  if (type === "sessions") return `Plus que ${plural(rounded, "session")}`;
  return `Plus que ${rounded} point${rounded > 1 ? "s" : ""}`;
}
