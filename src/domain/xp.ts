// Ported from the NovaFormation app (src/lib/xp.ts) — keep both in sync.
export interface LevelCurve {
  base: number;
  growth: number;
}

export const DEFAULT_LEVEL_CURVE: LevelCurve = { base: 100, growth: 1.5 };

export interface LevelInfo {
  level: number;
  currentLevelXp: number;
  xpToNextLevel: number;
  totalXpForCurrentLevel: number;
  totalXpForNextLevel: number;
  progress: number;
}

const MAX_LEVEL_ITERATIONS = 2000;

/** XP required to go from `level` to `level + 1`. Always at least 1 to guarantee termination. */
function xpRequiredForLevel(level: number, curve: LevelCurve): number {
  return Math.max(1, Math.round(curve.base * Math.pow(level, curve.growth)));
}

/** Derives level + progress-within-level from a total XP amount. Pure, deterministic. */
export function getLevelInfo(totalXp: number, curve: LevelCurve = DEFAULT_LEVEL_CURVE): LevelInfo {
  const xp = Number.isFinite(totalXp) ? Math.max(0, Math.floor(totalXp)) : 0;

  let level = 1;
  let cumulative = 0;

  for (let i = 0; i < MAX_LEVEL_ITERATIONS; i++) {
    const needed = xpRequiredForLevel(level, curve);
    if (cumulative + needed > xp) break;
    cumulative += needed;
    level += 1;
  }

  const xpToNextLevel = xpRequiredForLevel(level, curve);
  const currentLevelXp = xp - cumulative;

  return {
    level,
    currentLevelXp,
    xpToNextLevel,
    totalXpForCurrentLevel: cumulative,
    totalXpForNextLevel: cumulative + xpToNextLevel,
    progress: xpToNextLevel > 0 ? currentLevelXp / xpToNextLevel : 0,
  };
}
