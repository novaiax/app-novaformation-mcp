// Ported from NovaFormation (src/lib/activities.ts) — keep statistics aligned.
import type { Tables } from "./database.js";

export interface ActivityData {
  activities: Tables<"activities">[];
  sessions: Tables<"activity_sessions">[];
  rules: Tables<"activity_recurrence_rules">[];
  skills: Tables<"skills">[];
  activitySkills: Tables<"activity_skill_links">[];
  activityPrograms: Tables<"activity_program_links">[];
  sessionSkills: Tables<"activity_session_skills">[];
  suppressed: Tables<"activity_suppressed_occurrences">[];
  categories: Tables<"categories">[];
  programs: Pick<Tables<"programs">, "id" | "title" | "color">[];
}

type Activity = Tables<"activities">;
type Session = Tables<"activity_sessions">;
type Rule = Tables<"activity_recurrence_rules">;

export interface ActivityStats {
  scheduled: number;
  done: number;
  missed: number;
  cancelledSelf: number;
  cancelledOrganizer: number;
  postponed: number;
  remaining: number;
  needsReview: number;
  plannedMinutes: number;
  actualMinutes: number;
  averageMinutes: number;
  attendanceRate: number | null;
  progress: number;
  nextSession: Session | null;
}

const compareSessions = (a: Session, b: Session) =>
  a.session_date.localeCompare(b.session_date) ||
  (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
  a.sort_order - b.sort_order || a.id.localeCompare(b.id);

export function todayInParis(reference = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(reference);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/** Organiser cancellations and postponements never enter the attendance denominator. */
export function computeActivityStats(
  activity: Activity,
  sessions: Session[],
  today = todayInParis(),
): ActivityStats {
  const rows = sessions.filter((session) => session.activity_id === activity.id);
  const done = rows.filter((session) => session.status === "done");
  const missed = rows.filter((session) => session.status === "missed").length;
  const cancelledSelf = rows.filter((session) => session.status === "cancelled_self").length;
  const cancelledOrganizer = rows.filter((session) => session.status === "cancelled_organizer").length;
  const postponed = rows.filter((session) => session.status === "postponed").length;
  const eligible = rows.filter((session) => session.status !== "cancelled_organizer" && session.status !== "postponed");
  const remaining = rows.filter((session) => session.status === "planned" && session.session_date >= today).length;
  const needsReview = rows.filter((session) => session.status === "planned" && session.session_date < today).length;
  const plannedMinutes = eligible.reduce((sum, session) => sum + session.planned_minutes, 0);
  const actualMinutes = done.reduce((sum, session) => sum + Math.max(0, session.actual_minutes ?? 0), 0);
  const attendanceDenominator = done.length + missed + cancelledSelf;
  const attendanceRate = attendanceDenominator > 0 ? done.length / attendanceDenominator : null;
  const achieved = activity.goal_type === "hours" ? actualMinutes / 60
    : activity.goal_type === "attendance" ? (attendanceRate ?? 0) * 100 : done.length;
  const target = activity.goal_target === null ? eligible.length : Number(activity.goal_target);
  const progress = target > 0 ? Math.min(1, achieved / target) : 0;

  return {
    scheduled: eligible.length,
    done: done.length,
    missed,
    cancelledSelf,
    cancelledOrganizer,
    postponed,
    remaining,
    needsReview,
    plannedMinutes,
    actualMinutes,
    averageMinutes: done.length ? Math.round(actualMinutes / done.length) : 0,
    attendanceRate,
    progress,
    nextSession: rows.filter((session) => session.status === "planned" && session.session_date >= today)
      .sort(compareSessions)[0] ?? null,
  };
}

export const ACTIVITY_STATUS_LABELS: Record<Activity["status"], string> = {
  planned: "Prévue", active: "Active", paused: "En pause",
  completed: "Terminée", archived: "Archivée",
};

export const SESSION_STATUS_LABELS: Record<Session["status"], string> = {
  planned: "Prévue", done: "Réalisée", missed: "Manquée",
  cancelled_self: "Annulée par moi", cancelled_organizer: "Annulée par l’organisateur",
  postponed: "Reportée",
};

const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** Summary shown on the card; rule dates remain the source of truth. */
export function describeActivityRule(rule: Rule | undefined): string {
  if (!rule) return "Aucune récurrence";
  if (rule.frequency === "every_n_days") {
    return rule.interval_days === 1 ? "Chaque jour" : `Tous les ${rule.interval_days} jours`;
  }
  const weekdays = rule.weekdays.length ? rule.weekdays : [];
  const frequency = rule.week_interval === 1 ? "Chaque semaine" : `Toutes les ${rule.week_interval} semaines`;
  if (weekdays.length) return `${frequency}, ${weekdays.map((day) => WEEKDAYS[day]).join(" et ")}`;
  return `${rule.times_per_week ?? 1} fois/semaine · jours proposés automatiquement`;
}

export interface ActivityTimeBreakdown {
  id: string;
  label: string;
  minutes: number;
  sessions: number;
}

/** A session can contribute its full duration to several skills by design. */
export function activityTimeBreakdowns(data: ActivityData, sessions: Session[]) {
  const byActivity = new Map(data.activities.map((activity) => [activity.id, activity]));
  const activitySkills = new Map<string, string[]>();
  const sessionSkills = new Map<string, string[]>();
  const activityPrograms = new Map<string, string[]>();
  for (const link of data.activitySkills) activitySkills.set(link.activity_id, [...(activitySkills.get(link.activity_id) ?? []), link.skill_id]);
  for (const link of data.sessionSkills) sessionSkills.set(link.session_id, [...(sessionSkills.get(link.session_id) ?? []), link.skill_id]);
  for (const link of data.activityPrograms) activityPrograms.set(link.activity_id, [...(activityPrograms.get(link.activity_id) ?? []), link.program_id]);

  const maps = {
    activity: new Map<string, ActivityTimeBreakdown>(),
    category: new Map<string, ActivityTimeBreakdown>(),
    skill: new Map<string, ActivityTimeBreakdown>(),
    program: new Map<string, ActivityTimeBreakdown>(),
  };
  const skillLabels = new Map(data.skills.map((skill) => [skill.id, skill.name]));
  const programLabels = new Map(data.programs.map((program) => [program.id, program.title]));
  const categoryLabels = new Map(data.categories.map((category) => [category.id, category.name]));

  function add(map: Map<string, ActivityTimeBreakdown>, id: string, label: string, minutes: number) {
    const row = map.get(id) ?? { id, label, minutes: 0, sessions: 0 };
    row.minutes += minutes;
    row.sessions += 1;
    map.set(id, row);
  }

  for (const session of sessions) {
    if (session.status !== "done") continue;
    const activity = byActivity.get(session.activity_id);
    if (!activity) continue;
    const minutes = session.actual_minutes ?? 0;
    add(maps.activity, activity.id, activity.name, minutes);
    if (activity.category_id) add(maps.category, activity.category_id,
      categoryLabels.get(activity.category_id) ?? "Catégorie", minutes);
    const skills = sessionSkills.get(session.id) ??
      (session.skill_snapshot_complete ? [] : activitySkills.get(activity.id) ?? []);
    for (const skillId of skills) add(maps.skill, skillId, skillLabels.get(skillId) ?? "Compétence", minutes);
    for (const programId of activityPrograms.get(activity.id) ?? [])
      add(maps.program, programId, programLabels.get(programId) ?? "Programme", minutes);
  }

  return Object.fromEntries(Object.entries(maps).map(([key, map]) => [key,
    [...map.values()].sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label))])) as
    Record<keyof typeof maps, ActivityTimeBreakdown[]>;
}

export function activityPeriodSeries(sessions: Session[], period: "week" | "month") {
  const rows = new Map<string, { key: string; sessions: number; minutes: number }>();
  for (const session of sessions) {
    if (session.status !== "done") continue;
    let key = session.session_date.slice(0, 7);
    if (period === "week") {
      const [year, month, day] = session.session_date.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
      key = date.toISOString().slice(0, 10);
    }
    const row = rows.get(key) ?? { key, sessions: 0, minutes: 0 };
    row.sessions++;
    row.minutes += session.actual_minutes ?? 0;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
}
