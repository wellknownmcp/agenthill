import type { Constants } from "./constants";
import { DEFAULT_CONSTANTS } from "./constants";
import type {
  AccountInfo,
  DepositedMove,
  LedgerEntry,
  Occupant,
  PointsEntry,
  ResolveInput,
  ResolveOutput,
  SlotResolution,
  SlotState,
} from "./types";

/** Deterministic order of moves: receipt stamp, then agent, then place. */
function byDeposit(a: DepositedMove, b: DepositedMove): number {
  return a.receivedAt - b.receivedAt || cmp(a.agentId, b.agentId) || a.slot - b.slot;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function info(accounts: Record<string, AccountInfo>, id: string): AccountInfo {
  return accounts[id] ?? { createdAt: Number.MAX_SAFE_INTEGER, reputation: 0 };
}

/** Cooperators' queue: reputation desc, seniority asc, deposit asc. Never speed alone, never money. */
function byQueue(accounts: Record<string, AccountInfo>) {
  return (a: DepositedMove, b: DepositedMove): number => {
    const ia = info(accounts, a.accountId);
    const ib = info(accounts, b.accountId);
    return ib.reputation - ia.reputation || ia.createdAt - ib.createdAt || byDeposit(a, b);
  };
}

function occupantFrom(move: DepositedMove, holders: Occupant[]): Occupant {
  const was = holders.find((o) => o.accountId === move.accountId);
  return { accountId: move.accountId, agentId: move.agentId, daysHeld: was ? was.daysHeld + 1 : 0 };
}

/**
 * The bell. Pure: same inputs → same outputs, inputs untouched, no clock, no dice.
 *
 * Pass 1 resolves every place from its own moves (the four cases of the table).
 * Pass 2 serves burned places, in place order, from the global cooperators'
 * queue — every PEACE that obtained no place, ordered by reputation.
 */
export function resolveDay(input: ResolveInput, c: Constants = DEFAULT_CONSTANTS): ResolveOutput {
  const { state, accounts } = input;
  const moves = [...input.moves].filter((m) => m.move !== "PASS").sort(byDeposit);
  const granted: Record<string, number> = { ...(input.grantedCents ?? {}) };

  const slots: SlotResolution[] = [];
  const nextSlots: SlotState[] = [];
  const ledger: LedgerEntry[] = [];
  const queue: DepositedMove[] = [];

  for (let k = 1; k <= c.SLOTS; k++) {
    const holders = state.slots[k - 1]?.occupants ?? [];
    const P = moves.filter((m) => m.slot === k && m.move === "PEACE");
    const W = moves.filter((m) => m.slot === k && m.move === "WAR");

    const holdersInP = holders
      .map((h) => P.find((m) => m.accountId === h.accountId))
      .filter((m): m is DepositedMove => m !== undefined);
    const otherP = P.filter((m) => !holdersInP.includes(m));
    const ordered = [...holdersInP, ...otherP];

    let outcome: SlotResolution["outcome"];
    let occupants: Occupant[] = [];
    let leftovers: DepositedMove[] = [];
    let burnedCents = 0;

    if (W.length === 0 && P.length === 0) {
      outcome = "VACANT";
    } else if (W.length === 0) {
      outcome = "PEACE";
      occupants = ordered.slice(0, c.SHARE_MAX).map((m) => occupantFrom(m, holders));
      leftovers = ordered.slice(c.SHARE_MAX);
    } else if (W.length === 1) {
      outcome = "WAR";
      occupants = [occupantFrom(W[0]!, holders)];
      leftovers = ordered;
    } else {
      outcome = "BURN";
      occupants = ordered.slice(0, c.SHARE_MAX).map((m) => occupantFrom(m, holders));
      leftovers = ordered.slice(c.SHARE_MAX);
      burnedCents = W.reduce((s, m) => s + m.costCents, 0);
    }

    for (const m of P) ledger.push(entry(m, state.day, "RENT"));
    for (const m of W) ledger.push(entry(m, state.day, W.length >= 2 ? "BURN_STAKE" : "STAKE"));

    queue.push(...leftovers);
    nextSlots.push({ occupants });
    slots.push({
      slot: k,
      outcome,
      peaceCount: P.length,
      warCount: W.length,
      occupants,
      evicted: holders.filter((h) => !occupants.some((o) => o.accountId === h.accountId)),
      burnedCents,
      fromQueue: [],
    });
  }

  // Pass 2 — the queue serves burned places, most visible first.
  queue.sort(byQueue(accounts));
  for (const res of slots) {
    if (res.outcome !== "BURN") continue;
    const holders = state.slots[res.slot - 1]?.occupants ?? [];
    while (res.occupants.length < c.SHARE_MAX && queue.length > 0) {
      const m = queue.shift()!;
      const occ = occupantFrom(m, holders);
      res.occupants.push(occ);
      res.fromQueue.push(m);
      res.evicted = res.evicted.filter((h) => h.accountId !== occ.accountId);
    }
    nextSlots[res.slot - 1] = { occupants: res.occupants };
  }

  // Points: 11 − k per occupant, halved when shared. Money plays no part.
  const points: PointsEntry[] = [];
  for (const res of slots) {
    const base = c.SLOTS + 1 - res.slot;
    const each = res.occupants.length > 1 ? base / res.occupants.length : base;
    for (const o of res.occupants) points.push({ accountId: o.accountId, day: state.day, slot: res.slot, points: each });
  }

  // Granted credits are consumed first, in deterministic ledger order.
  ledger.sort((a, b) => a.slot - b.slot || cmp(a.agentId, b.agentId) || cmp(a.kind, b.kind));
  for (const e of ledger) {
    const g = granted[e.accountId] ?? 0;
    const use = Math.min(g, e.cents);
    e.grantedCents = use;
    granted[e.accountId] = g - use;
  }

  return {
    nextState: { day: state.day + 1, slots: nextSlots },
    ledger,
    points,
    slots,
    queueLeftovers: queue,
  };
}

function entry(m: DepositedMove, day: number, kind: LedgerEntry["kind"]): LedgerEntry {
  return { accountId: m.accountId, agentId: m.agentId, day, slot: m.slot, kind, cents: m.costCents, grantedCents: 0 };
}
