// Ported from the NovaFormation app (src/lib/programs.test.ts) — keep both in sync.
import { describe, expect, it } from "vitest";
import { aggregateProgramsProgress, computeProgramProgress } from "../../src/domain/programs.js";

describe("computeProgramProgress", () => {
  it("returns 0 progress for a program with no items", () => {
    expect(computeProgramProgress({ program_weeks: [] })).toEqual({
      total: 0,
      completed: 0,
      progress: 0,
    });
  });

  it("counts completed items across nested weeks and modules", () => {
    const program = {
      program_weeks: [
        {
          program_modules: [
            { module_items: [{ is_completed: true }, { is_completed: false }] },
          ],
        },
        {
          program_modules: [{ module_items: [{ is_completed: true }] }],
        },
      ],
    };
    expect(computeProgramProgress(program)).toEqual({ total: 3, completed: 2, progress: 2 / 3 });
  });

  it("does not divide by zero when a week has empty modules", () => {
    const program = { program_weeks: [{ program_modules: [] }] };
    expect(computeProgramProgress(program).progress).toBe(0);
  });
});

describe("aggregateProgramsProgress", () => {
  it("returns 0 progress for an empty program list", () => {
    expect(aggregateProgramsProgress([])).toEqual({ total: 0, completed: 0, progress: 0 });
  });

  it("sums totals and completions across multiple programs", () => {
    const programA = {
      program_weeks: [{ program_modules: [{ module_items: [{ is_completed: true }] }] }],
    };
    const programB = {
      program_weeks: [
        { program_modules: [{ module_items: [{ is_completed: false }, { is_completed: false }] }] },
      ],
    };
    expect(aggregateProgramsProgress([programA, programB])).toEqual({
      total: 3,
      completed: 1,
      progress: 1 / 3,
    });
  });
});
