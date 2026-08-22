/**
 * Scripted agents for the balancing simulation. Every strategy only reads what
 * a real agent could read after the bell (public history, its own wallet).
 * Randomness, when a strategy needs a tie-break, comes from a seeded LCG that
 * lives HERE — the engine never sees it.
 */
import type { DayState, MoveInput, SlotResolution } from "@agenthill/engine";
import type { SimAnnouncement } from "./announce";

export type StrategyName = "dove" | "hawk" | "tit_for_tat" | "scout" | "opportunist" | "bluffer";

export interface PublicDay {
  day: number;
  slots: SlotResolution[];
}

export interface AgentView {
  accountId: string;
  agentId: string;
  strategy: StrategyName;
  day: number;
  state: DayState;
  history: PublicDay[];
  walletCents: number;
  /** My reputation rank among accounts that played PEACE in the last 7 days (1 = best). */
  queueRank: number;
  reputation: number;
  rentIfHolding: (slot: number) => number;
  /** Today's public announcements — everybody's, mine included. Empty when the channel is off. */
  announcements: SimAnnouncement[];
  /** What an account's word has been worth lately, in [0, 1]. */
  believe: (accountId: string) => number;
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

/**
 * Bluffer: never wars, and says it will. Announces WAR on an established place,
 * then deposits a PEACE on that same place — verdict `bluffed`, every time.
 *
 * It exists to answer one question the balancing could not answer by argument:
 * is the announcement channel exploitable? Note what it costs to find out — a
 * challenger's PEACE is the floor, so a bluff is 3 $ a night, and it pays the
 * moment one holder walks away. Note also what it does NOT cost: this agent
 * only ever PLAYS peace, so its move-reputation is a perfect 1.0 and it sits at
 * the top of the cooperators' queue while lying every single day. The record of
 * words is the only place it can be caught.
 */
export const bluffer: Strategy = (v) => {
  if (v.walletCents < FLOOR) return [];
  const mine = mySlots(v);
  if (mine.length > 0 && v.walletCents >= v.rentIfHolding(mine[0]!)) return [peace(v, mine[0]!)];
  const target = blufferTarget(v);
  return target === null ? dove(v) : [peace(v, target)];
};

/**
 * The place to point at: the one whose holder pays the most, because rent grows
 * with every night held. That holder is the likeliest to be relieved to leave —
 * and whoever takes the place next starts again at the floor. Deterministic on
 * purpose: the target must be identical in the announcing pass and in the
 * depositing pass, or the agent would announce one place and play another by
 * accident, which is a bug wearing the costume of a strategy.
 */
export function blufferTarget(v: AgentView): number | null {
  const held = [...Array(10).keys()]
    .map((i) => i + 1)
    .filter((s) => (v.state.slots[s - 1]?.occupants.length ?? 0) > 0 && !mySlots(v).includes(s));
  if (held.length === 0) return null;
  return held.sort((a, b) => holderRent(v, b) - holderRent(v, a) || a - b)[0]!;
}

export const STRATEGIES: Record<StrategyName, Strategy> = { dove, hawk, tit_for_tat: titForTat, scout, opportunist, bluffer };

/**
 * What each strategy SAYS, before anyone has deposited anything.
 *
 * Silence is a position too, and two of these take it: announcing where you are
 * going invites a challenge on exactly that place, so an agent whose whole plan
 * is to sit somewhere quiet has a reason to say nothing. Returning null is that
 * choice, not a missing implementation.
 */
export type Announcer = (v: AgentView, intent: Omit<MoveInput, "receivedAt">[]) => { slot: number; move: "PEACE" | "WAR" } | null;

const truthfully: Announcer = (_v, intent) => {
  const m = intent[0];
  if (!m || m.move === "PASS") return null;
  return { slot: m.slot, move: m.move as "PEACE" | "WAR" };
};

export const ANNOUNCERS: Record<StrategyName, Announcer> = {
  // Nothing to hide, and a kept record is worth having when you live in the queue.
  dove: truthfully,
  // Wants the deterrence: a hawk that announces its war and makes it is the
  // only agent here whose word costs its opponents money.
  hawk: truthfully,
  // Legibility IS the strategy — "I strike back" only works when it is known.
  tit_for_tat: truthfully,
  // Reads the room, never briefs it: its edge is knowing where the heat is
  // going before the others, and announcing would give that away.
  scout: () => null,
  // Hunts quiet places. Saying so makes them loud.
  opportunist: () => null,
  bluffer: (v) => {
    const target = blufferTarget(v);
    return target === null ? null : { slot: target, move: "WAR" };
  },
};

/**
 * How much an agent lets someone else's word change its night, in [0, 1],
 * multiplied by how much that word is currently worth.
 *
 * A hawk at 0 is not stubbornness — it is the reason the channel cannot empty
 * the hill on its own: someone always shows up anyway.
 */
export const DETERRABILITY: Record<StrategyName, number> = {
  dove: 0.9,
  scout: 0.8,
  opportunist: 0.7,
  tit_for_tat: 0.4,
  bluffer: 0.2,
  hawk: 0,
};

/**
 * The one place where a sentence can change the night.
 *
 * A move aimed at a place someone credibly promised to attack is dropped with
 * probability `deterrability × belief`. A challenger backs off to the calmest
 * unthreatened place; a HOLDER that backs off loses its place, which is exactly
 * how a bluff turns into a cheap conquest. A deterred WAR simply never happens
 * — that is the war count falling, and with it the burn, and with it the
 * revenue. Whether that is a good trade is what the runs are for.
 *
 * `roll` is its own generator, not the agent's: the rolls happen only when the
 * channel is on, and drawing them from the shared stream would have shifted
 * every later draw, making the silent run and the talking run two different
 * worlds instead of the same world with one difference.
 */
export function afterReadingTheRoom(v: AgentView, moves: Omit<MoveInput, "receivedAt">[], roll: () => number): Omit<MoveInput, "receivedAt">[] {
  if (v.announcements.length === 0 || moves.length === 0) return moves;
  const threat = (slot: number): number => {
    let worst = 0;
    for (const a of v.announcements) {
      if (a.slot !== slot || a.move !== "WAR" || a.accountId === v.accountId) continue;
      const b = v.believe(a.accountId);
      if (b > worst) worst = b;
    }
    return worst;
  };
  const out: Omit<MoveInput, "receivedAt">[] = [];
  for (const m of moves) {
    const t = threat(m.slot);
    if (t === 0 || roll() >= DETERRABILITY[v.strategy] * t) {
      out.push(m);
      continue;
    }
    if (m.move === "PEACE") {
      const alt = [...Array(10).keys()]
        .map((i) => i + 1)
        .filter((s) => s !== m.slot && threat(s) === 0)
        .sort((a, b) => warsOn(v, a, 3) - warsOn(v, b, 3) || a - b)[0];
      if (alt !== undefined) out.push({ ...m, slot: alt });
    }
  }
  return out;
}
