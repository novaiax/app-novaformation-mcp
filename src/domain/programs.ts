// Ported from the NovaFormation app (src/lib/programs.ts) — keep both in sync.
interface ProgramProgressInput {
  program_weeks: {
    program_modules: {
      module_items: { is_completed: boolean }[];
    }[];
  }[];
}

export interface ProgramProgress {
  total: number;
  completed: number;
  progress: number;
}

/** Flattens a program's nested weeks → modules → items to a completion ratio. */
export function computeProgramProgress(program: ProgramProgressInput): ProgramProgress {
  let total = 0;
  let completed = 0;

  for (const week of program.program_weeks) {
    for (const programModule of week.program_modules) {
      for (const item of programModule.module_items) {
        total += 1;
        if (item.is_completed) completed += 1;
      }
    }
  }

  return { total, completed, progress: total > 0 ? completed / total : 0 };
}

/** Aggregate completion ratio across every program (used for the dashboard's "Overall Progress"). */
export function aggregateProgramsProgress(programs: ProgramProgressInput[]): ProgramProgress {
  const totals = programs.map(computeProgramProgress);
  const total = totals.reduce((sum, p) => sum + p.total, 0);
  const completed = totals.reduce((sum, p) => sum + p.completed, 0);
  return { total, completed, progress: total > 0 ? completed / total : 0 };
}
