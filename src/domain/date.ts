// Ported from the NovaFormation app (src/lib/date.ts) — keep both in sync.
import { format, parseISO, subDays } from "date-fns";

export const DATE_FORMAT = "yyyy-MM-dd";

export function toDateKey(date: Date): string {
  return format(date, DATE_FORMAT);
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function previousDayKey(dateKey: string): string {
  return toDateKey(subDays(parseISO(dateKey), 1));
}

/** 1055 → "17 h 35 min", 120 → "2 h", 45 → "45 min". */
export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}
