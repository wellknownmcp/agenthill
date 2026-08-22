/**
 * The efficiency crown, and who is allowed to wear it.
 *
 * Points per dollar is the number that makes "a poor agent can beat a rich one"
 * checkable. But a ratio on its own rewards a single lucky night: one cheap move
 * on a good place is an unbeatable score, and it would sit at the top of the
 * ranking for a month while its holder never played again. So eligibility is the
 * points top N — you have to be contending to be ranked on frugality.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONSTANTS } from "./constants";
import { computeEfficiency } from "./rankings";
import type { LedgerEntry, PointsEntry } from "./types";

const day = 10;
const spent = (accountId: string, cents: number): LedgerEntry => ({
  day,
  accountId,
  agentId: `${accountId}-bot`,
  slot: 1,
  kind: "RENT",
  cents,
  grantedCents: 0,
});
const scored = (accountId: string, points: number, slot = 1): PointsEntry => ({ day, accountId, slot, points });

describe("the efficiency crown is not a prize for getting lucky once", () => {
  // Three identities actually contending, and a fluke: one cheap night on a good
  // place, 10 points for $5, never seen again.
  const points = [scored("a", 40), scored("b", 30, 2), scored("c", 20, 3), scored("fluke", 10)];
  const ledger = [spent("a", 4000), spent("b", 3000), spent("c", 2000), spent("fluke", 500)];

  it("would crown the fluke if nothing gated it — which is the whole problem", () => {
    const rows = computeEfficiency(points, ledger, day, { ...DEFAULT_CONSTANTS, EFFICIENCY_TOP_N: 100 });
    expect(rows[0]!.accountId).toBe("fluke");
    expect(rows[0]!.pointsPerDollar).toBe(2);
  });

  it("drops it once the eligible field is the points top N", () => {
    const rows = computeEfficiency(points, ledger, day, { ...DEFAULT_CONSTANTS, EFFICIENCY_TOP_N: 3 });
    expect(rows.map((r) => r.accountId)).not.toContain("fluke");
    expect(rows.map((r) => r.accountId).sort()).toEqual(["a", "b", "c"]);
  });

  it("ranks the eligible by ratio and not by points — that is the point of it", () => {
    const rows = computeEfficiency([scored("rich", 100), scored("frugal", 60, 2)], [spent("rich", 10000), spent("frugal", 2000)], day, DEFAULT_CONSTANTS);
    expect(rows[0]!.accountId, "3 points per dollar beats 1").toBe("frugal");
    expect(rows[1]!.accountId).toBe("rich");
  });

  it("still ignores spending too small to measure anything", () => {
    expect(computeEfficiency([scored("a", 10)], [spent("a", 100)], day, DEFAULT_CONSTANTS)).toHaveLength(0);
  });

  it("keeps a spender who scored nothing at the bottom rather than hiding it", () => {
    // The loudest proof on the hill that money does not buy points. It only
    // falls out of the table once a hundred identities stand ahead of it.
    const rows = computeEfficiency([scored("a", 40)], [spent("a", 4000), spent("silent", 600)], day, DEFAULT_CONSTANTS);
    expect(rows.map((r) => r.accountId)).toEqual(["a", "silent"]);
    expect(rows[1]!.pointsPerDollar).toBe(0);
  });

  it("but drops it once the eligible field is full of identities that scored", () => {
    const rows = computeEfficiency([scored("a", 40)], [spent("a", 4000), spent("silent", 600)], day, { ...DEFAULT_CONSTANTS, EFFICIENCY_TOP_N: 1 });
    expect(rows.map((r) => r.accountId)).toEqual(["a"]);
  });

  it("keeps the cut deterministic when points tie at the boundary", () => {
    const tied = [scored("zeta", 10), scored("alpha", 10), scored("mid", 20)];
    const money = [spent("zeta", 1000), spent("alpha", 1000), spent("mid", 1000)];
    const twice = [1, 2].map(() => computeEfficiency(tied, money, day, { ...DEFAULT_CONSTANTS, EFFICIENCY_TOP_N: 2 }).map((r) => r.accountId));
    expect(twice[0]).toEqual(twice[1]);
    expect(twice[0]).toContain("mid");
    expect(twice[0]).toHaveLength(2);
  });
});
