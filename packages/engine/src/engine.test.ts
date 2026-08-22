/**
 * The test suite IS the specification. Criteria numbers (A1…A18) refer to the
 * sprint contract. Tests were written before the engine.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONSTANTS,
  rentCents,
  emptyState,
  validateMove,
  resolveDay,
  computeWall,
  computeLeaderboard,
  computeHallOfFame,
  computeReputation,
  computeEfficiency,
  normalizeText,
  type DayState,
  type DepositedMove,
  type AccountInfo,
  type LedgerEntry,
  type PointsEntry,
  type Constants,
} from "./index";

const C: Constants = { ...DEFAULT_CONSTANTS };

// ── helpers ─────────────────────────────────────────────────────────────────

let seq = 0;
function mv(
  accountId: string,
  slot: number,
  move: "PEACE" | "WAR" | "PASS",
  opts: { stake?: number; cost?: number; at?: number; agentId?: string; message?: string } = {},
): DepositedMove {
  seq += 1;
  const cost = opts.cost ?? (move === "WAR" ? (opts.stake ?? C.WAR_MIN_STAKE_CENTS) : move === "PEACE" ? C.RENT_FLOOR_CENTS : 0);
  const m: DepositedMove = {
    accountId,
    agentId: opts.agentId ?? `${accountId}-bot`,
    slot,
    move,
    receivedAt: opts.at ?? seq,
    costCents: cost,
  };
  if (move === "WAR") m.stakeCents = opts.stake ?? C.WAR_MIN_STAKE_CENTS;
  if (opts.message !== undefined) m.message = opts.message;
  return m;
}

function accounts(...ids: string[]): Record<string, AccountInfo> {
  const out: Record<string, AccountInfo> = {};
  ids.forEach((id, i) => {
    out[id] = { createdAt: 1000 + i, reputation: 0 };
  });
  return out;
}

function withHolder(state: DayState, slot: number, accountId: string, daysHeld = 0): DayState {
  const s = structuredClone(state);
  s.slots[slot - 1]!.occupants.push({ accountId, agentId: `${accountId}-bot`, daysHeld });
  return s;
}

function occupantIds(out: ReturnType<typeof resolveDay>, slot: number): string[] {
  return out.nextState.slots[slot - 1]!.occupants.map((o) => o.accountId);
}

/** Tiny deterministic PRNG for property tests — lives in the TESTS, never in the engine. */
function lcg(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

// ── A4 rent ─────────────────────────────────────────────────────────────────

describe("A4 — holder rent = ceil(floor × growth^daysHeld)", () => {
  it.each([
    [0, 300],
    [1, 345],
    [5, 604],
    [10, 1214],
    [20, 4910],
    [30, 19864],
  ])("daysHeld %i → %i cents", (days, cents) => {
    expect(rentCents(days, C)).toBe(cents);
  });

  it("a holder who loses the place and takes it back restarts at daysHeld 0", () => {
    let state = withHolder(emptyState(1, C), 3, "a", 9);
    // day 1: a abandons (no move), b takes it
    let out = resolveDay({ state, moves: [mv("b", 3, "PEACE")], accounts: accounts("a", "b") });
    expect(occupantIds(out, 3)).toEqual(["b"]);
    // day 2: b abandons, a comes back
    out = resolveDay({ state: out.nextState, moves: [mv("a", 3, "PEACE")], accounts: accounts("a", "b") });
    expect(out.nextState.slots[2]!.occupants[0]).toMatchObject({ accountId: "a", daysHeld: 0 });
  });
});

// ── A1 the four cases ───────────────────────────────────────────────────────

describe("A1 — the four cases of the resolution table", () => {
  it("no moves → vacant, no ledger line", () => {
    const out = resolveDay({ state: emptyState(1, C), moves: [], accounts: {} });
    expect(out.slots[0]!.outcome).toBe("VACANT");
    expect(out.ledger).toHaveLength(0);
    expect(out.points).toHaveLength(0);
  });

  it("peace only → occupants share, each PEACE pays rent whether served or not", () => {
    const moves = [mv("a", 1, "PEACE"), mv("b", 1, "PEACE"), mv("c", 1, "PEACE")];
    const out = resolveDay({ state: emptyState(1, C), moves, accounts: accounts("a", "b", "c") });
    expect(out.slots[0]!.outcome).toBe("PEACE");
    expect(occupantIds(out, 1)).toEqual(["a", "b"]);
    expect(out.queueLeftovers.map((m) => m.accountId)).toEqual(["c"]);
    const rents = out.ledger.filter((l) => l.kind === "RENT");
    expect(rents).toHaveLength(3);
    expect(rents.every((l) => l.cents === 300)).toBe(true);
  });

  it("one war against peace → the warrior takes the place alone; peace still pays", () => {
    const state = withHolder(emptyState(1, C), 2, "h", 4);
    const holderRent = rentCents(4, C);
    const moves = [mv("h", 2, "PEACE", { cost: holderRent }), mv("w", 2, "WAR", { stake: 900 })];
    const out = resolveDay({ state, moves, accounts: accounts("h", "w") });
    expect(out.slots[1]!.outcome).toBe("WAR");
    expect(occupantIds(out, 2)).toEqual(["w"]);
    expect(out.slots[1]!.evicted.map((o) => o.accountId)).toEqual(["h"]);
    expect(out.ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: "w", kind: "STAKE", cents: 900 }),
        expect.objectContaining({ accountId: "h", kind: "RENT", cents: holderRent }),
      ]),
    );
    expect(out.ledger).toHaveLength(2);
  });

  it("two wars → every stake burns, nobody at war occupies, place goes to the best cooperator", () => {
    const moves = [mv("x", 1, "WAR", { stake: 800 }), mv("y", 1, "WAR", { stake: 5000 }), mv("p", 1, "PEACE")];
    const out = resolveDay({ state: emptyState(1, C), moves, accounts: accounts("x", "y", "p") });
    expect(out.slots[0]!.outcome).toBe("BURN");
    expect(occupantIds(out, 1)).toEqual(["p"]);
    expect(out.slots[0]!.burnedCents).toBe(5800);
    const burns = out.ledger.filter((l) => l.kind === "BURN_STAKE");
    expect(burns.map((l) => l.cents).sort((a, b) => a - b)).toEqual([800, 5000]);
    expect(out.ledger.filter((l) => l.kind === "STAKE")).toHaveLength(0);
  });
});

// ── A2 mutual war: order (a)(b)(c)(d) ───────────────────────────────────────

describe("A2 — mutual war: (a) holder in P, (b) P by deposit, (c) global queue, (d) vacant", () => {
  const wars = (slot: number) => [mv("x", slot, "WAR"), mv("y", slot, "WAR")];

  it("(a) the holder who played peace keeps the place", () => {
    const state = withHolder(emptyState(1, C), 1, "h", 2);
    const out = resolveDay({
      state,
      moves: [...wars(1), mv("p", 1, "PEACE"), mv("h", 1, "PEACE", { cost: rentCents(2, C) })],
      accounts: accounts("h", "p", "x", "y"),
    });
    expect(occupantIds(out, 1)).toEqual(["h", "p"]);
    expect(out.nextState.slots[0]!.occupants[0]!.daysHeld).toBe(3);
  });

  it("(b) peace on this place, by deposit order", () => {
    const out = resolveDay({
      state: emptyState(1, C),
      moves: [...wars(1), mv("p2", 1, "PEACE", { at: 50 }), mv("p1", 1, "PEACE", { at: 10 }), mv("p3", 1, "PEACE", { at: 90 })],
      accounts: accounts("p1", "p2", "p3", "x", "y"),
    });
    expect(occupantIds(out, 1)).toEqual(["p1", "p2"]);
    expect(out.queueLeftovers.map((m) => m.accountId)).toEqual(["p3"]);
  });

  it("(c) the global queue serves a burned place, most reputable first", () => {
    // place 1: peace from q1 and q2 and q3 → q3 unserved (SHARE_MAX 2) goes to the queue
    // place 2: mutual war, no peace → served from the queue
    const acc = accounts("q1", "q2", "q3", "x", "y");
    const out = resolveDay({
      state: emptyState(1, C),
      moves: [mv("q1", 1, "PEACE"), mv("q2", 1, "PEACE"), mv("q3", 1, "PEACE"), ...wars(2)],
      accounts: acc,
    });
    expect(occupantIds(out, 2)).toEqual(["q3"]);
    expect(out.slots[1]!.fromQueue.map((m) => m.accountId)).toEqual(["q3"]);
    expect(out.queueLeftovers).toHaveLength(0);
  });

  it("(d) nobody in the queue → the burned place stays empty", () => {
    const out = resolveDay({ state: emptyState(1, C), moves: wars(4), accounts: accounts("x", "y") });
    expect(out.slots[3]!.outcome).toBe("BURN");
    expect(occupantIds(out, 4)).toEqual([]);
  });

  it("three warriors burn all three stakes", () => {
    const out = resolveDay({
      state: emptyState(1, C),
      moves: [mv("x", 1, "WAR", { stake: 800 }), mv("y", 1, "WAR", { stake: 800 }), mv("z", 1, "WAR", { stake: 1200 })],
      accounts: accounts("x", "y", "z"),
    });
    expect(out.slots[0]!.burnedCents).toBe(2800);
    expect(out.ledger.filter((l) => l.kind === "BURN_STAKE")).toHaveLength(3);
  });
});

// ── A3 the stake never decides ──────────────────────────────────────────────

describe("A3 — the stake never influences the outcome", () => {
  it("permuting stakes between warriors leaves nextState identical (200 cases)", () => {
    const rnd = lcg(42);
    for (let i = 0; i < 200; i++) {
      const ids = ["a", "b", "c", "d", "e"];
      const moves: DepositedMove[] = [];
      const stakes: number[] = [];
      ids.forEach((id, k) => {
        const r = rnd();
        const slot = 1 + Math.floor(rnd() * 3);
        if (r < 0.5) {
          const stake = 800 + Math.floor(rnd() * 5000);
          stakes.push(stake);
          moves.push(mv(id, slot, "WAR", { stake, at: k }));
        } else {
          moves.push(mv(id, slot, "PEACE", { at: k }));
        }
      });
      const base = resolveDay({ state: emptyState(1, C), moves, accounts: accounts(...ids) });
      // rotate the stakes among the warriors
      const warriors = moves.filter((m) => m.move === "WAR");
      const rotated = moves.map((m) => {
        if (m.move !== "WAR") return m;
        const idx = warriors.indexOf(m);
        const next = warriors[(idx + 1) % warriors.length]!;
        return { ...m, stakeCents: next.stakeCents!, costCents: next.costCents };
      });
      const alt = resolveDay({ state: emptyState(1, C), moves: rotated, accounts: accounts(...ids) });
      expect(alt.nextState).toEqual(base.nextState);
      expect(alt.points).toEqual(base.points);
    }
  });
});

// ── A5 SHARE_MAX and the queue across places ────────────────────────────────

describe("A5 — SHARE_MAX, queue consumed in place order, nobody served twice", () => {
  it("4 peace on place 1, mutual wars on 2 and 3 → queue serves 2 then 3, each once", () => {
    const acc = accounts("p1", "p2", "p3", "p4", "x", "y", "z", "w");
    acc["p3"]!.reputation = 0.9; // p3 more reputable than p4 → served first
    const out = resolveDay({
      state: emptyState(1, C),
      moves: [
        mv("p1", 1, "PEACE", { at: 1 }),
        mv("p2", 1, "PEACE", { at: 2 }),
        mv("p3", 1, "PEACE", { at: 3 }),
        mv("p4", 1, "PEACE", { at: 4 }),
        mv("x", 2, "WAR"),
        mv("y", 2, "WAR"),
        mv("z", 3, "WAR"),
        mv("w", 3, "WAR"),
      ],
      accounts: acc,
    });
    expect(occupantIds(out, 1)).toEqual(["p1", "p2"]);
    expect(occupantIds(out, 2)).toEqual(["p3", "p4"]);
    expect(occupantIds(out, 3)).toEqual([]);
    const all = out.nextState.slots.flatMap((s) => s.occupants.map((o) => o.accountId));
    expect(new Set(all).size).toBe(all.length);
  });
});

// ── A6 / A7 / A17 / A18 validation ──────────────────────────────────────────

describe("A6 — each refusal has exactly one trigger", () => {
  const base = { state: emptyState(1, C), deposited: [] as DepositedMove[], availableCents: 10_000 };
  const input = (over: Partial<Parameters<typeof validateMove>[0]> = {}) => ({
    accountId: "a",
    agentId: "a-bot",
    slot: 1,
    move: "PEACE" as const,
    receivedAt: 1,
    ...over,
  });

  it("valid PEACE is accepted with the floor rent", () => {
    const r = validateMove(input(), base, C);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.move?.costCents).toBe(300);
  });
  it("INVALID_SLOT", () => {
    expect(validateMove(input({ slot: 0 }), base, C)).toMatchObject({ ok: false, code: "INVALID_SLOT" });
    expect(validateMove(input({ slot: 11 }), base, C)).toMatchObject({ ok: false, code: "INVALID_SLOT" });
  });
  it("MAX_MOVES_AGENT — third distinct place for the same agent", () => {
    const deposited = [mv("a", 1, "PEACE", { agentId: "a-bot" }), mv("a", 2, "PEACE", { agentId: "a-bot" })];
    expect(validateMove(input({ slot: 3 }), { ...base, deposited }, C)).toMatchObject({ ok: false, code: "MAX_MOVES_AGENT" });
  });
  it("MAX_MOVES_ACCOUNT — fleets of agents on one account are capped", () => {
    const deposited = [
      mv("a", 1, "PEACE", { agentId: "a1" }),
      mv("a", 2, "PEACE", { agentId: "a1" }),
      mv("a", 3, "PEACE", { agentId: "a2" }),
      mv("a", 4, "PEACE", { agentId: "a2" }),
    ];
    expect(validateMove(input({ slot: 5, agentId: "a3" }), { ...base, deposited }, C)).toMatchObject({ ok: false, code: "MAX_MOVES_ACCOUNT" });
  });
  it("STAKE_TOO_LOW and STAKE_ABOVE_MANDATE", () => {
    expect(validateMove(input({ move: "WAR", stakeCents: 799 }), base, C)).toMatchObject({ ok: false, code: "STAKE_TOO_LOW" });
    expect(validateMove(input({ move: "WAR", stakeCents: 1501 }), { ...base, mandate: { dailyCapCents: 100_000, maxStakeCents: 1500 } }, C)).toMatchObject({ ok: false, code: "STAKE_ABOVE_MANDATE" });
  });
  it("INSUFFICIENT_FUNDS", () => {
    expect(validateMove(input(), { ...base, availableCents: 299 }, C)).toMatchObject({ ok: false, code: "INSUFFICIENT_FUNDS" });
  });
  it("DAILY_CAP", () => {
    const deposited = [mv("a", 1, "WAR", { stake: 800 })];
    expect(validateMove(input({ slot: 2, move: "WAR", stakeCents: 800 }), { ...base, deposited, mandate: { dailyCapCents: 1500, maxStakeCents: 5000 } }, C)).toMatchObject({ ok: false, code: "DAILY_CAP" });
  });
  it("MESSAGE_TOO_LONG", () => {
    expect(validateMove(input({ message: "x".repeat(141) }), base, C)).toMatchObject({ ok: false, code: "MESSAGE_TOO_LONG" });
  });
});

describe("A7 — mandate cumulates across agents; replacement releases escrow", () => {
  const mandate = { dailyCapCents: 1000, maxStakeCents: 1500 };
  it("cap reached by a second agent of the same account", () => {
    const deposited = [mv("a", 1, "WAR", { stake: 800, agentId: "a1" })];
    const r = validateMove({ accountId: "a", agentId: "a2", slot: 2, move: "PEACE", receivedAt: 2 }, { state: emptyState(1, C), deposited, availableCents: 10_000, mandate }, C);
    expect(r).toMatchObject({ ok: false, code: "DAILY_CAP" }); // 800 + 300 > 1000
  });
  it("replacing a move frees its escrow for the cap and the balance", () => {
    const first = mv("a", 1, "WAR", { stake: 800, agentId: "a1" });
    const r = validateMove({ accountId: "a", agentId: "a1", slot: 1, move: "PEACE", receivedAt: 2 }, { state: emptyState(1, C), deposited: [first], availableCents: 100, mandate }, C);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.replaced).toBe(first);
      expect(r.move?.costCents).toBe(300); // 100 available + 800 released ≥ 300
    }
  });
  it("a stake exactly at maxStake passes (the cap is on the stake, the day cap is separate)", () => {
    const r = validateMove({ accountId: "a", agentId: "a1", slot: 1, move: "WAR", stakeCents: 1500, receivedAt: 1 }, { state: emptyState(1, C), deposited: [], availableCents: 10_000, mandate: { dailyCapCents: 5000, maxStakeCents: 1500 } }, C);
    expect(r.ok).toBe(true);
    const over = validateMove({ accountId: "a", agentId: "a1", slot: 1, move: "WAR", stakeCents: 1500, receivedAt: 1 }, { state: emptyState(1, C), deposited: [], availableCents: 10_000, mandate }, C);
    expect(over).toMatchObject({ ok: false, code: "DAILY_CAP" }); // 1500 > the 1000 daily cap of this describe
  });
});

describe("A17 — PASS withdraws a move", () => {
  it("PASS on an existing move releases it, costs nothing, frees the agent's slot budget", () => {
    const first = mv("a", 1, "WAR", { stake: 800, agentId: "a1" });
    const r = validateMove({ accountId: "a", agentId: "a1", slot: 1, move: "PASS", receivedAt: 2 }, { state: emptyState(1, C), deposited: [first], availableCents: 0 }, C);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.move).toBeNull();
      expect(r.replaced).toBe(first);
    }
  });
  it("PASS with nothing to withdraw is a no-op, not an error", () => {
    const r = validateMove({ accountId: "a", agentId: "a1", slot: 1, move: "PASS", receivedAt: 2 }, { state: emptyState(1, C), deposited: [], availableCents: 0 }, C);
    expect(r).toMatchObject({ ok: true, move: null, replaced: null });
  });
  it("PASS produces no ledger line at the bell", () => {
    const out = resolveDay({ state: emptyState(1, C), moves: [mv("a", 1, "PASS")], accounts: accounts("a") });
    expect(out.ledger).toHaveLength(0);
    expect(out.slots[0]!.outcome).toBe("VACANT");
  });
});

describe("A18 — default mandate when the human set none (10 $/day, 15 $ max stake)", () => {
  it("three PEACE (9 $) pass, a fourth move of 8 $ is refused by the daily cap", () => {
    const deposited = [mv("a", 1, "PEACE", { agentId: "a1" }), mv("a", 2, "PEACE", { agentId: "a1" }), mv("a", 3, "PEACE", { agentId: "a2" })];
    const r = validateMove({ accountId: "a", agentId: "a2", slot: 4, move: "WAR", stakeCents: 800, receivedAt: 9 }, { state: emptyState(1, C), deposited, availableCents: 100_000 }, C);
    expect(r).toMatchObject({ ok: false, code: "DAILY_CAP" });
  });
  it("a stake above 15 $ is refused without an explicit mandate", () => {
    const r = validateMove({ accountId: "a", agentId: "a1", slot: 1, move: "WAR", stakeCents: 1501, receivedAt: 1 }, { state: emptyState(1, C), deposited: [], availableCents: 100_000 }, C);
    expect(r).toMatchObject({ ok: false, code: "STAKE_ABOVE_MANDATE" });
  });
});

// ── A8 escrow property ──────────────────────────────────────────────────────

describe("A8 — escrows never exceed the balance", () => {
  it("random sequences of deposits/replacements/withdrawals (200 sequences)", () => {
    const rnd = lcg(7);
    for (let s = 0; s < 200; s++) {
      const balance = 500 + Math.floor(rnd() * 5000);
      let deposited: DepositedMove[] = [];
      const mandate = { dailyCapCents: 1_000_000, maxStakeCents: 1_000_000 };
      for (let step = 0; step < 12; step++) {
        const escrow = deposited.reduce((a, m) => a + m.costCents, 0);
        const move = rnd() < 0.2 ? "PASS" : rnd() < 0.5 ? "WAR" : "PEACE";
        const r = validateMove(
          { accountId: "a", agentId: `a${1 + Math.floor(rnd() * 2)}`, slot: 1 + Math.floor(rnd() * 2), move, stakeCents: 800 + Math.floor(rnd() * 2000), receivedAt: step },
          { state: emptyState(1, C), deposited, availableCents: balance - escrow, mandate },
          C,
        );
        if (r.ok) {
          if (r.replaced) deposited = deposited.filter((m) => m !== r.replaced);
          if (r.move) deposited = [...deposited, r.move];
        }
        const after = deposited.reduce((a, m) => a + m.costCents, 0);
        expect(after).toBeLessThanOrEqual(balance);
      }
    }
  });
});

// ── A9 / A10 idempotence and determinism ────────────────────────────────────

describe("A9/A10 — idempotent and deterministic", () => {
  it("resolving the same inputs twice yields deep-equal outputs", () => {
    const state = withHolder(emptyState(1, C), 1, "h", 3);
    const moves = [mv("h", 1, "PEACE", { cost: rentCents(3, C) }), mv("x", 1, "WAR"), mv("y", 1, "WAR"), mv("p", 2, "PEACE"), mv("q", 2, "PEACE"), mv("r", 2, "PEACE")];
    const a = resolveDay({ state, moves, accounts: accounts("h", "x", "y", "p", "q", "r") });
    const b = resolveDay({ state, moves, accounts: accounts("h", "x", "y", "p", "q", "r") });
    expect(b).toEqual(a);
    expect(b.ledger.length).toBe(a.ledger.length);
  });

  it("move order in the input array does not matter — only (receivedAt, agentId) does (200 cases)", () => {
    const rnd = lcg(99);
    for (let i = 0; i < 200; i++) {
      const ids = ["a", "b", "c", "d", "e", "f"];
      const moves = ids.map((id, k) => (rnd() < 0.4 ? mv(id, 1 + Math.floor(rnd() * 2), "WAR", { at: 100 - k }) : mv(id, 1 + Math.floor(rnd() * 2), "PEACE", { at: 100 - k })));
      const shuffled = [...moves].sort(() => rnd() - 0.5);
      const a = resolveDay({ state: emptyState(1, C), moves, accounts: accounts(...ids) });
      const b = resolveDay({ state: emptyState(1, C), moves: shuffled, accounts: accounts(...ids) });
      expect(b.nextState).toEqual(a.nextState);
      expect(b.points).toEqual(a.points);
    }
  });

  it("does not mutate its inputs", () => {
    const state = withHolder(emptyState(1, C), 1, "h", 3);
    const snapshot = structuredClone(state);
    resolveDay({ state, moves: [mv("x", 1, "WAR"), mv("y", 1, "WAR")], accounts: accounts("h", "x", "y") });
    expect(state).toEqual(snapshot);
  });
});

// ── A12 abandon ─────────────────────────────────────────────────────────────

describe("A12 — a holder without a move abandons, free of charge", () => {
  it("place freed, no ledger line for the holder", () => {
    const state = withHolder(emptyState(1, C), 5, "h", 7);
    const out = resolveDay({ state, moves: [], accounts: accounts("h") });
    expect(occupantIds(out, 5)).toEqual([]);
    expect(out.ledger.filter((l) => l.accountId === "h")).toHaveLength(0);
    expect(out.slots[4]!.evicted.map((o) => o.accountId)).toEqual(["h"]);
  });
});

// ── A13 the Wall ────────────────────────────────────────────────────────────

describe("A13 — the Wall: 30-day rolling real money, burns count, ties by earliest", () => {
  const L = (accountId: string, day: number, cents: number, kind: LedgerEntry["kind"] = "RENT", grantedCents = 0): LedgerEntry => ({ accountId, agentId: `${accountId}-bot`, day, slot: 1, kind, cents, grantedCents });

  it("top 5, burned stakes counted, day 31 drops day 1", () => {
    const ledger: LedgerEntry[] = [];
    ledger.push(L("old", 1, 100_000)); // will fall out of the window at day 31
    ledger.push(L("a", 5, 3000), L("a", 6, 3000, "BURN_STAKE"));
    ledger.push(L("b", 7, 5000, "STAKE"));
    ledger.push(L("c", 8, 1000));
    ledger.push(L("d", 9, 900));
    ledger.push(L("e", 10, 800));
    ledger.push(L("f", 11, 700));
    ledger.push(L("g", 12, 600));
    const atDay30 = computeWall(ledger, 30, C);
    expect(atDay30.map((w) => w.accountId)).toEqual(["old", "a", "b", "c", "d"]);
    expect(atDay30[1]).toMatchObject({ accountId: "a", cents: 6000 });
    const atDay31 = computeWall(ledger, 31, C);
    expect(atDay31.map((w) => w.accountId)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("ties go to the account that reached the total first", () => {
    const ledger = [L("late", 3, 1000), L("early", 2, 1000)];
    expect(computeWall(ledger, 10, C).map((w) => w.accountId)).toEqual(["early", "late"]);
  });
});

// ── A13b points ─────────────────────────────────────────────────────────────

describe("A13b — hill points: 11 − k, halved when shared, money never matters", () => {
  it("points at the bell", () => {
    const out = resolveDay({
      state: emptyState(1, C),
      moves: [mv("a", 1, "PEACE"), mv("b", 1, "PEACE"), mv("c", 10, "PEACE")],
      accounts: accounts("a", "b", "c"),
    });
    expect(out.points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: "a", slot: 1, points: 5 }),
        expect.objectContaining({ accountId: "b", slot: 1, points: 5 }),
        expect.objectContaining({ accountId: "c", slot: 10, points: 1 }),
      ]),
    );
  });

  it("leaderboard lists every account (zeros included), ties by seniority; hall of fame is lifetime", () => {
    const P = (accountId: string, day: number, points: number): PointsEntry => ({ accountId, day, slot: 1, points });
    const points = [P("a", 1, 10), P("b", 20, 10), P("c", 35, 10), P("d", 5, 3)];
    const acc = accounts("b", "a", "c", "d", "zero"); // b is more senior than a
    const lb = computeLeaderboard(points, 35, acc, C);
    expect(lb.map((r) => [r.accountId, r.points])).toEqual([
      ["b", 10],
      ["c", 10],
      ["a", 0], // day 1 is outside [6, 35]
      ["d", 0], // day 5 is outside the window too
      ["zero", 0],
    ]);
    const hof = computeHallOfFame(points, acc);
    expect(hof.slice(0, 3).map((r) => [r.accountId, r.points])).toEqual([
      ["b", 10],
      ["a", 10],
      ["c", 10],
    ]);
  });

  it("permuting spent amounts never changes the leaderboard (200 cases)", () => {
    const rnd = lcg(3);
    for (let i = 0; i < 200; i++) {
      const ids = ["a", "b", "c", "d"];
      const moves = ids.map((id, k) => (rnd() < 0.5 ? mv(id, 1, "WAR", { stake: 800 + Math.floor(rnd() * 9000), at: k }) : mv(id, 1, "PEACE", { at: k })));
      const a = resolveDay({ state: emptyState(1, C), moves, accounts: accounts(...ids) });
      const moves2 = moves.map((m) => ({ ...m, costCents: m.costCents * 3, stakeCents: m.stakeCents ? m.stakeCents * 3 : undefined }));
      const b = resolveDay({ state: emptyState(1, C), moves: moves2 as DepositedMove[], accounts: accounts(...ids) });
      expect(b.points).toEqual(a.points);
    }
  });
});

// ── A15 granted credits ─────────────────────────────────────────────────────

describe("A15 — granted credits are consumed first and never count for the Wall", () => {
  it("debits carry their granted part", () => {
    const out = resolveDay({
      state: emptyState(1, C),
      moves: [mv("a", 1, "PEACE"), mv("a", 2, "WAR", { stake: 800, agentId: "a2" })],
      accounts: accounts("a"),
      grantedCents: { a: 500 },
    });
    const rent = out.ledger.find((l) => l.kind === "RENT")!;
    const stake = out.ledger.find((l) => l.kind === "STAKE")!;
    expect(rent.grantedCents).toBe(300);
    expect(stake.grantedCents).toBe(200);
    const wall = computeWall(out.ledger, 1, C);
    expect(wall[0]).toMatchObject({ accountId: "a", cents: 600 }); // 1100 − 500
  });

  it("granted credits reduce real money exactly by what they covered; points untouched (200 cases)", () => {
    const rnd = lcg(11);
    for (let i = 0; i < 200; i++) {
      const ids = ["a", "b", "c"];
      const moves = ids.map((id, k) => (rnd() < 0.5 ? mv(id, 1 + k, "WAR", { stake: 800 + Math.floor(rnd() * 2000) }) : mv(id, 1 + k, "PEACE")));
      const base = resolveDay({ state: emptyState(1, C), moves, accounts: accounts(...ids) });
      const granted: Record<string, number> = { a: Math.floor(rnd() * 3000), b: Math.floor(rnd() * 3000), c: 0 };
      const withGrants = resolveDay({ state: emptyState(1, C), moves, accounts: accounts(...ids), grantedCents: granted });
      expect(withGrants.points).toEqual(base.points);
      const real = (l: LedgerEntry[], id: string) => l.filter((e) => e.accountId === id).reduce((s, e) => s + e.cents - e.grantedCents, 0);
      const spent = (l: LedgerEntry[], id: string) => l.filter((e) => e.accountId === id).reduce((s, e) => s + e.cents, 0);
      for (const id of ids) {
        expect(spent(withGrants.ledger, id)).toBe(spent(base.ledger, id));
        expect(real(withGrants.ledger, id)).toBe(spent(base.ledger, id) - Math.min(granted[id]!, spent(base.ledger, id)));
        expect(withGrants.ledger.filter((e) => e.accountId === id).every((e) => e.grantedCents >= 0 && e.grantedCents <= e.cents)).toBe(true);
      }
    }
  });
});

// ── A16 queue by reputation ─────────────────────────────────────────────────

describe("A16 — the cooperators' queue is ordered by reputation, then seniority, then deposit", () => {
  it("the faster deposit does not win against a better reputation", () => {
    const acc = accounts("fast", "slow", "x", "y");
    acc["fast"]!.reputation = 0.2;
    acc["slow"]!.reputation = 0.8;
    const out = resolveDay({
      state: emptyState(1, C),
      // both are peaceful leftovers from place 1 (served: p1, p2), contesting burned place 2 via the queue
      moves: [mv("p1", 1, "PEACE", { at: 1 }), mv("p2", 1, "PEACE", { at: 2 }), mv("fast", 1, "PEACE", { at: 3 }), mv("slow", 1, "PEACE", { at: 900 }), mv("x", 2, "WAR"), mv("y", 2, "WAR")],
      accounts: { ...acc, ...accounts("p1", "p2") },
    });
    expect(occupantIds(out, 2)).toEqual(["slow", "fast"]);
  });

  it("equal reputation → seniority; equal seniority → deposit time", () => {
    const acc = accounts("junior", "senior"); // senior created later in helper order → fix explicitly
    acc["senior"]!.createdAt = 1;
    acc["junior"]!.createdAt = 2;
    const all = { ...acc, ...accounts("p1", "p2", "x", "y") };
    const out = resolveDay({
      state: emptyState(1, C),
      moves: [mv("p1", 1, "PEACE", { at: 1 }), mv("p2", 1, "PEACE", { at: 2 }), mv("junior", 1, "PEACE", { at: 3 }), mv("senior", 1, "PEACE", { at: 4 }), mv("x", 2, "WAR"), mv("y", 2, "WAR")],
      accounts: all,
    });
    expect(occupantIds(out, 2)).toEqual(["senior", "junior"]);
  });

  it("permuting receivedAt among queue members with distinct reputations changes nothing (200 cases)", () => {
    const rnd = lcg(5);
    for (let i = 0; i < 200; i++) {
      const acc = accounts("p1", "p2", "q1", "q2", "q3", "x", "y");
      acc["q1"]!.reputation = 0.9;
      acc["q2"]!.reputation = 0.5;
      acc["q3"]!.reputation = 0.1;
      const times = [10, 20, 30].sort(() => rnd() - 0.5);
      const moves = [mv("p1", 1, "PEACE", { at: 1 }), mv("p2", 1, "PEACE", { at: 2 }), mv("q1", 1, "PEACE", { at: times[0]! }), mv("q2", 1, "PEACE", { at: times[1]! }), mv("q3", 1, "PEACE", { at: times[2]! }), mv("x", 2, "WAR"), mv("y", 2, "WAR")];
      const out = resolveDay({ state: emptyState(1, C), moves, accounts: acc });
      expect(occupantIds(out, 2)).toEqual(["q1", "q2"]);
      expect(out.queueLeftovers.map((m) => m.accountId)).toEqual(["q3"]);
    }
  });

  it("reputation = share of PEACE in the account's moves over the window, 0 without history", () => {
    const history = [
      { accountId: "a", day: 1, move: "PEACE" as const },
      { accountId: "a", day: 2, move: "WAR" as const },
      { accountId: "a", day: 3, move: "PEACE" as const },
      { accountId: "a", day: 40, move: "WAR" as const },
    ];
    expect(computeReputation(history, 3, "a", C)).toBeCloseTo(2 / 3);
    expect(computeReputation(history, 40, "a", C)).toBeCloseTo(0); // days 11..40: only the WAR
    expect(computeReputation(history, 3, "nobody", C)).toBe(0);
  });
});

// ── A14 text normalization ──────────────────────────────────────────────────

describe("A14 — third-party text is normalized, bounded, never trusted", () => {
  it("strips control characters and newlines, trims, truncates to the limit", () => {
    expect(normalizeText(" abc\n<script>", 140)).toBe("abc<script>");
    expect(normalizeText("x".repeat(200), 140)).toHaveLength(140);
    expect(normalizeText("é", 10)).toBe("é"); // NFC
  });
  it("empty after normalization → empty string", () => {
    expect(normalizeText(" \n\t  ", 140)).toBe("");
  });
});

// ── A11 is a static check (no randomness / clock / deps) — see no-randomness.test.ts

// ── Efficiency — the second crown ───────────────────────────────────────────

describe("points per dollar", () => {
  const P = (accountId: string, day: number, points: number): PointsEntry => ({ accountId, day, slot: 1, points });
  const L = (accountId: string, day: number, cents: number, grantedCents = 0): LedgerEntry => ({ accountId, agentId: `${accountId}-bot`, day, slot: 1, kind: "RENT", cents, grantedCents });

  it("a frugal player beats a spender at equal points — the whole claim of the game", () => {
    const points = [P("frugal", 5, 40), P("rich", 5, 40)];
    const ledger = [L("frugal", 5, 1200), L("rich", 5, 8000)];
    const rows = computeEfficiency(points, ledger, 5, C);
    expect(rows[0]!.accountId).toBe("frugal");
    expect(rows[0]!.pointsPerDollar).toBeCloseTo(40 / 12, 2);
    expect(rows[1]!.accountId).toBe("rich");
  });

  it("a sample of one is not a performance: below the floor, no entry", () => {
    const rows = computeEfficiency([P("lucky", 1, 10)], [L("lucky", 1, 300)], 1, C);
    expect(rows).toHaveLength(0);
  });

  it("granted credits count in the denominator — this measures skill, not a wallet", () => {
    const rows = computeEfficiency([P("a", 1, 10)], [L("a", 1, 1000, 1000)], 1, C);
    expect(rows[0]!.spentCents).toBe(1000);
    expect(rows[0]!.pointsPerDollar).toBe(1);
  });

  it("only the rolling window counts", () => {
    const points = [P("a", 1, 100), P("a", 40, 10)];
    const ledger = [L("a", 1, 5000), L("a", 40, 1000)];
    const rows = computeEfficiency(points, ledger, 40, C);
    expect(rows[0]!.points).toBe(10);
    expect(rows[0]!.spentCents).toBe(1000);
  });

  it("someone who spent and scored nothing is listed at zero, not hidden", () => {
    const rows = computeEfficiency([], [L("burned", 3, 4000)], 3, C);
    expect(rows[0]).toMatchObject({ accountId: "burned", points: 0, pointsPerDollar: 0 });
  });
});
