/**
 * Scripted agents for the balancing simulation. Every strategy only reads what
 * a real agent could read after the bell (public history, its own wallet).
 * Randomness, when a strategy needs a tie-break, comes from a seeded LCG that
 * lives HERE — the engine never sees it.
 */
import type { DayState, MoveInput, SlotResolution } from "@agenthill/engine";

export type StrategyName = "dove" | "hawk" | "tit_for_tat" | "scout" | "opportunist";

export interface PublicDay {
  day: number;
  slots: SlotResolution[];
}

export interface AgentView {
  accountId: string;
  agentId: string;
  day: number;
  state: DayState;
  history: PublicDay[];
  walletCents: number;
  /** My reputation rank among accounts that played PEACE in the last 7 days (1 = best). */
  queueRank: number;
  reputation: number;
  rentIfHolding: (slot: number) => number;
  rnd: () => number;
}

export type Strategy = (v: AgentView) => Omit<MoveInput, "receivedAt">[];

const WAR_MIN = 800;
const FLOOR = 300;

function mySlots(v: AgentView): number[] {
  return v.state.slots.flatMap((s, i) => (s.occupants.some((o) => o.accountId === v.accountId) ? [i + 1] : []));
}

function warsOn(v: AgentView, slot: number, days = 1): number {
  return v.history.slice(-days).reduce((n, d) => n + (d.slots[slot - 1]?.warCount ?? 0), 0);
}

function holderRent(v: AgentView, slot: number): number {
  const occ = v.state.slots[slot - 1]?.occupants ?? [];
  if (occ.length === 0) return 0;
  const days = Math.max(...occ.map((o) => o.daysHeld));
  return Math.ceil(FLOOR * Math.pow(1.15, days));
}

function attackedYesterday(v: AgentView): number | null {
  const y = v.history[v.history.length - 1];
  if (!y) return null;
  for (const s of y.slots) {
    if (s.outcome === "WAR" && s.evicted.some((o) => o.accountId === v.accountId)) return s.slot;
  }
  return null;
}

const peace = (v: AgentView, slot: number) => ({ accountId: v.accountId, agentId: v.agentId, slot, move: "PEACE" as const });
const war = (v: AgentView, slot: number, stake = WAR_MIN) => ({ accountId: v.accountId, agentId: v.agentId, slot, move: "WAR" as const, stakeCents: stake });

/** Dove: peace, always. Keeps its place; otherwise picks the calmest place. */
export const dove: Strategy = (v) => {
  const mine = mySlots(v);
  if (mine.length > 0) return v.walletCents >= v.rentIfHolding(mine[0]!) ? [peace(v, mine[0]!)] : [];
  if (v.walletCents < FLOOR) return [];
  const calm = [...Array(10).keys()].map((i) => i + 1).sort((a, b) => warsOn(v, a, 3) - warsOn(v, b, 3) || a - b);
  return [peace(v, calm[0]!)];
};

/** Hawk: war on the most visible place it can afford, every single day. */
export const hawk: Strategy = (v) => {
  if (v.walletCents >= WAR_MIN) return [war(v, 1 + Math.floor(v.rnd() * 3))];
  if (v.walletCents >= FLOOR) return [peace(v, 10)];
  return [];
};

/** Tit-for-tat: peace by default, strikes back once on the place it was evicted from. */
export const titForTat: Strategy = (v) => {
  const hit = attackedYesterday(v);
  if (hit !== null && v.walletCents >= WAR_MIN) return [war(v, hit)];
  return dove(v);
};

/**
 * Scout: never wars. Reads rent and heat. Leaves a place before rent gets
 * silly, waits on places whose holder is about to crack, and when its queue
 * rank is first, sits in peace on the hottest place to inherit the burn.
 */
export const scout: Strategy = (v) => {
  const mine = mySlots(v);
  if (v.walletCents < FLOOR) return [];
  if (mine.length > 0) {
    const slot = mine[0]!;
    if (v.rentIfHolding(slot) <= 1000 && v.walletCents >= v.rentIfHolding(slot)) return [peace(v, slot)];
    // rent is climbing past 10 $/day: let go and come back fresh elsewhere
  }
  const slots = [...Array(10).keys()].map((i) => i + 1);
  if (v.queueRank === 1) {
    const hottest = [...slots].sort((a, b) => warsOn(v, b, 2) - warsOn(v, a, 2) || a - b)[0]!;
    if (warsOn(v, hottest, 2) >= 2) return [peace(v, hottest)];
  }
  const target = [...slots]
    .filter((s) => !mine.includes(s))
    .sort((a, b) => {
      const va = (holderRent(v, a) >= 900 ? 1 : 0) * 100 - warsOn(v, a, 3) * 10 + (11 - a);
      const vb = (holderRent(v, b) >= 900 ? 1 : 0) * 100 - warsOn(v, b, 3) * 10 + (11 - b);
      return vb - va;
    })[0]!;
  return [peace(v, target)];
};

/** Opportunist: wars only on a quiet place held by a low-reputation holder; peace otherwise. */
export const opportunist: Strategy = (v) => {
  const mine = mySlots(v);
  if (mine.length > 0 && v.walletCents >= v.rentIfHolding(mine[0]!)) return [peace(v, mine[0]!)];
  if (v.walletCents >= WAR_MIN) {
    const quiet = [...Array(10).keys()].map((i) => i + 1).filter((s) => warsOn(v, s, 2) === 0 && (v.state.slots[s - 1]?.occupants.length ?? 0) > 0);
    if (quiet.length > 0) return [war(v, quiet[0]!)];
  }
  return dove(v);
};

export const STRATEGIES: Record<StrategyName, Strategy> = { dove, hawk, tit_for_tat: titForTat, scout, opportunist };
