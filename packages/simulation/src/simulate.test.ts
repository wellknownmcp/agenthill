/**
 * A20 — balancing guard: a strategy that only reads public information and
 * never wars (scout) must beat "always war" on points at equal budget. If it
 * does not, the constants are wrong, not the strategy.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_MIX, simulate } from "./simulate";

describe("A20 — scout beats hawk at equal budget, 30 days, several seeds", () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}`, () => {
      const t0 = performance.now();
      const r = simulate({ days: 30, seed, budgetCents: 10_000, mix: DEFAULT_MIX });
      const by = Object.fromEntries(r.byStrategy.map((s) => [s.strategy, s]));
      const perAgent = (s: string) => by[s]!.points / by[s]!.agents;
      expect(perAgent("scout")).toBeGreaterThan(perAgent("hawk"));
      expect(by["scout"]!.spentCents / by["scout"]!.agents).toBeLessThanOrEqual(by["hawk"]!.spentCents / by["hawk"]!.agents);
      expect(performance.now() - t0).toBeLessThan(1000);
    });
  }

  it("the simulation is deterministic for a given seed", () => {
    const a = simulate({ days: 10, seed: 9, budgetCents: 10_000, mix: DEFAULT_MIX });
    const b = simulate({ days: 10, seed: 9, budgetCents: 10_000, mix: DEFAULT_MIX });
    expect(b.points).toEqual(a.points);
    expect(b.ledger).toEqual(a.ledger);
  });
});
