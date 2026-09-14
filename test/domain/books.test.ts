// Ported from the NovaFormation app (src/lib/books.test.ts) — keep both in sync.
import { describe, expect, it } from "vitest";
import { computeBookStats } from "../../src/domain/books.js";

describe("computeBookStats", () => {
  it("returns zeros and a null reading speed for an empty library", () => {
    expect(computeBookStats([])).toEqual({ completed: 0, pagesRead: 0, readingSpeed: null });
  });

  it("counts completed books and sums pages read across all statuses", () => {
    const books = [
      { status: "completed", current_page: 300, started_at: "2026-06-01" },
      { status: "reading", current_page: 120, started_at: "2026-06-10" },
      { status: "to_read", current_page: 0, started_at: null },
    ];
    const stats = computeBookStats(books, new Date("2026-06-11"));
    expect(stats.completed).toBe(1);
    expect(stats.pagesRead).toBe(420);
  });

  it("computes reading speed as pages per day since the earliest start date", () => {
    const books = [{ status: "reading", current_page: 100, started_at: "2026-06-01" }];
    const stats = computeBookStats(books, new Date("2026-06-11")); // 10 days later
    expect(stats.readingSpeed).toBe(10);
  });

  it("returns a null reading speed when no book has been started yet", () => {
    const books = [{ status: "to_read", current_page: 0, started_at: null }];
    expect(computeBookStats(books).readingSpeed).toBeNull();
  });

  it("never divides by zero for a book started today", () => {
    const today = new Date("2026-06-11");
    const books = [{ status: "reading", current_page: 50, started_at: "2026-06-11" }];
    expect(computeBookStats(books, today).readingSpeed).toBe(50);
  });
});
