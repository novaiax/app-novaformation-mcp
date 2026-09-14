// Ported from the NovaFormation app (src/lib/books.ts) — keep both in sync.
import { differenceInCalendarDays } from "date-fns";

export interface BookStatsInput {
  status: string;
  current_page: number;
  started_at: string | null;
}

export interface BookStats {
  completed: number;
  pagesRead: number;
  /** Pages per day since the earliest book was started, or null if there isn't enough data yet. */
  readingSpeed: number | null;
}

export function computeBookStats(
  books: BookStatsInput[],
  referenceDate: Date = new Date(),
): BookStats {
  const completed = books.filter((b) => b.status === "completed").length;
  const pagesRead = books.reduce((sum, b) => sum + Math.max(0, b.current_page), 0);

  const startedDates = books
    .map((b) => b.started_at)
    .filter((d): d is string => Boolean(d))
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()));

  if (startedDates.length === 0 || pagesRead === 0) {
    return { completed, pagesRead, readingSpeed: null };
  }

  const earliest = startedDates.reduce((min, d) => (d < min ? d : min), startedDates[0]);
  const days = Math.max(1, differenceInCalendarDays(referenceDate, earliest));

  return { completed, pagesRead, readingSpeed: Math.round((pagesRead / days) * 10) / 10 };
}
