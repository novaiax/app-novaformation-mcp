// Ported from the NovaFormation app (src/lib/exercise-goal-labels.test.ts) — keep both in sync.
import { describe, expect, it } from "vitest";
import { describeGoal, describeRemaining, formatGoalValue } from "../../src/domain/exercise-goal-labels.js";

describe("describeGoal", () => {
  it("phrases each objective type", () => {
    expect(describeGoal({ type: "minutes", target: 1000, period: "total" }, 10)).toBe("1000 minutes de pratique");
    expect(describeGoal({ type: "sessions", target: 3, period: "week" }, 10)).toBe("3 sessions cette semaine");
    expect(describeGoal({ type: "sessions", target: 1, period: "month" }, 10)).toBe("1 session ce mois-ci");
    expect(describeGoal({ type: "score", target: 7, period: "total" }, 20)).toBe("Score moyen de 7 / 20");
  });

  it("accepts numeric strings coming from Postgres", () => {
    expect(describeGoal({ type: "minutes", target: "600" as unknown as number, period: "total" }, 10)).toBe(
      "600 minutes de pratique",
    );
  });
});

describe("formatGoalValue", () => {
  it("adds the unit for the objective type", () => {
    expect(formatGoalValue("minutes", 1055, 10)).toBe("1055 min");
    expect(formatGoalValue("sessions", 12, 10)).toBe("12 sessions");
    expect(formatGoalValue("score", 6.83, 10)).toBe("6.8 / 10");
  });
});

describe("describeRemaining", () => {
  it("expresses long durations in hours", () => {
    expect(describeRemaining("minutes", 45)).toBe("Plus que 45 min");
    expect(describeRemaining("minutes", 125)).toBe("Plus que 2 h 5 min");
  });

  it("pluralises sessions and points", () => {
    expect(describeRemaining("sessions", 1)).toBe("Plus que 1 session");
    expect(describeRemaining("score", 0.4)).toBe("Plus que 0.4 point");
    expect(describeRemaining("score", 2)).toBe("Plus que 2 points");
  });
});
