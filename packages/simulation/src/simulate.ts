import type { MoveInput } from "@agenthill/engine";
import {
  DEFAULT_CONSTANTS,
  computeLeaderboard,
  computeReputation,
  computeWall,
  emptyState,
  rentCents,
  resolveDay,
  validateMove,
  type AccountInfo,
  type Constants,
  type DayState,
  type DepositedMove,
  type LedgerEntry,
  type MoveHistoryEntry,
  type PointsEntry,
} from "@agenthill/engine";
import { ANNOUNCERS, STRATEGIES, afterReadingTheRoom, type AgentView, type PublicDay, type StrategyName } from "./strategies";
import { beliefIn, settle, truthCounts, type SettledAnnouncement, type SimAnnouncement } from "./announce";

export interface SimAgent {
  accountId: string;
  agentId: string;
  strategy: StrategyName;
  walletCents: number;
  createdAt: number;
  refuels: number;
  purchasedCents: number;
  /** Day this identity joined. 0 for the founding cohort. */
  joinedDay: number;
  /** Consecutive days ending with no place. The thing that eventually kills interest. */
  dry: number;
  /** Stopped playing: the human got bored of paying for nothing. */
  quit: boolean;
}

export interface SimConfig {
  days: number;
  seed: number;
  budgetCents: number;
  mix: Record<StrategyName, number>;
  constants?: Partial<Constants>;
  /** Humans refuel: when the wallet drops below `refuelBelowCents`, add `refuelCents`, at most `maxRefuels` times. */
  refuel?: { belowCents: number; cents: number; max: number };
  /** New identities arriving every day, because somebody read the journal. */
  arrivals?: { perDay: number; budgetCents: number; mix?: Record<StrategyName, number> };
  /**
   * Refuelling driven by ego rather than by a counter.
   *
   * The mechanical `refuel` above tops up anyone who is short, which quietly
   * assumes an infinitely patient wallet and hides the only question that
   * matters: does wanting your name at the top actually pay for the game? Here a
   * human pays when there is something to lose or something in reach — a place
   * held, a rank near the top, a slot on the Wall — and stops when there has
   * been nothing for `quitAfterDryDays`.
   */
  ego?: {
    cents: number;
    /** Probability of paying when the agent is currently holding a place. */
    holding: number;
    /** ...when inside the points top N, or inside/near the Wall. */
    contender: number;
    /** ...when neither: someone still hoping. */
    baseline: number;
    leaderboardTopN: number;
    /** Days in a row with no place before the human gives up for good. */
    quitAfterDryDays: number;
  };
  /**
   * Turn on the announcement channel (§7 decies). Words never touch the
   * resolution — `resolveDay` is not even told they happened — so the only
   * thing this can move is how many agents show up on a contested place.
   */
  announcements?: {
    /** Rolling window for truthfulness, matching the server's. */
    windowDays: number;
    /** Benefit of the doubt given to an account nobody has anything on yet. */
    priorBelief: number;
  };
}

export interface StrategyStats {
  strategy: StrategyName;
  agents: number;
  points: number;
  spentCents: number;
  burnedCents: number;
  daysOnHill: number;
  pointsPerDollar: number;
  /** What this strategy said, and what became of it. */
  announced: number;
  kept: number;
  betrayed: number;
  bluffed: number;
  ghosted: number;
}

export interface SimResult {
  days: number;
  finalState: DayState;
  ledger: LedgerEntry[];
  points: PointsEntry[];
  history: PublicDay[];
  byStrategy: StrategyStats[];
  totals: {
    spentCents: number; burnedCents: number; rentCents: number; burnRatio: number; warsPerDay: number; queueServed: number;
    purchasedCents: number; refuels: number; vacantSlotNights: number;
    /** Identities that joined after day 1, humans who gave up, and who is left. */
    arrived: number; quits: number; activeAtEnd: number; identities: number;
    /** The channel: what was said, and how often a sentence changed a move. */
    announced: number; deterred: number;
  };
  wall: { accountId: string; strategy: StrategyName; cents: number }[];
  leaderboard: { accountId: string; strategy: StrategyName; points: number }[];
  agents: SimAgent[];
  /** Every scored announcement of the run. Empty when the channel was off. */
  settled: SettledAnnouncement[];
}

/** A move that vanished, or moved to another place, after reading the room. */
function countDeterred(before: { slot: number; move: string }[], after: { slot: number; move: string }[]): number {
  let n = 0;
  for (const b of before) if (!after.some((x) => x.slot === b.slot && x.move === b.move)) n += 1;
  return n;
}

function lcg(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

export function simulate(cfg: SimConfig): SimResult {
  const c: Constants = { ...DEFAULT_CONSTANTS, ...(cfg.constants ?? {}) };
  /**
   * Three independent streams, so that turning a knob changes that knob and
   * nothing else. Sharing one generator made the comparison worthless: the
   * extra draws of the announcement channel shifted every later draw, so the
   * "with" run got a different set of arrivals from the "without" run and the
   * per-strategy columns were partly noise.
   *   births — who arrives, and as what. Its own stream because the cohort
   *            must be identical in every run, or the strategy columns compare
   *            two different populations;
   *   world — top-ups and who calls the server first;
   *   agent — whatever a strategy needs to break a tie;
   *   talk  — the deterrence rolls, drawn only when the channel is on.
   */
  const births = lcg(cfg.seed);
  const world = lcg(cfg.seed ^ 0xc2b2ae35);
  const rnd = lcg(cfg.seed ^ 0x9e3779b9);
  const talk = lcg(cfg.seed ^ 0x85ebca6b);
  const agents: SimAgent[] = [];
  let n = 0;
  for (const [strategy, count] of Object.entries(cfg.mix) as [StrategyName, number][]) {
    for (let i = 0; i < count; i++) {
      n += 1;
      agents.push({ accountId: `${strategy}-${i + 1}`, agentId: `${strategy}-${i + 1}-bot`, strategy, walletCents: cfg.budgetCents, createdAt: n, refuels: 0, purchasedCents: cfg.budgetCents, joinedDay: 0, dry: 0, quit: false });
    }
  }
  const byId = new Map(agents.map((a) => [a.accountId, a]));

  let state = emptyState(1, c);
  const ledger: LedgerEntry[] = [];
  const points: PointsEntry[] = [];
  const moveHistory: MoveHistoryEntry[] = [];
  const history: PublicDay[] = [];
  let queueServed = 0;
  let wars = 0;
  let arrivalDebt = 0;
  let arrived = 0;
  let quits = 0;
  const settled: SettledAnnouncement[] = [];
  let announced = 0;
  let deterred = 0;

  for (let day = 1; day <= cfg.days; day++) {
    // Arrivals: somebody read the journal and pointed an agent at the hill.
    if (cfg.arrivals && cfg.arrivals.perDay > 0 && day > 1) {
      const mix = cfg.arrivals.mix ?? cfg.mix;
      // Drawn PROPORTIONALLY to the mix, not uniformly over its keys. Uniform
      // sampling quietly rewrote the population: a mix declaring twice as many
      // doves as bluffers produced as many of each, and a strategy set to zero
      // still walked in the door.
      const weights = (Object.entries(mix) as [StrategyName, number][]).filter(([, w]) => w > 0);
      const total = weights.reduce((x, [, w]) => x + w, 0);
      arrivalDebt += cfg.arrivals.perDay;
      while (arrivalDebt >= 1 && total > 0) {
        arrivalDebt -= 1;
        n += 1;
        let ticket = births() * total;
        let strategy = weights[weights.length - 1]![0];
        for (const [name, w] of weights) {
          ticket -= w;
          if (ticket < 0) {
            strategy = name;
            break;
          }
        }
        const a: SimAgent = {
          accountId: `${strategy}-n${n}`,
          agentId: `${strategy}-n${n}-bot`,
          strategy,
          walletCents: cfg.arrivals.budgetCents,
          createdAt: n,
          refuels: 0,
          purchasedCents: cfg.arrivals.budgetCents,
          joinedDay: day,
          dry: 0,
          quit: false,
        };
        agents.push(a);
        byId.set(a.accountId, a);
        arrived += 1;
      }
    }

    const accounts: Record<string, AccountInfo> = {};
    for (const a of agents) accounts[a.accountId] = { createdAt: a.createdAt, reputation: computeReputation(moveHistory, day - 1, a.accountId, c) };

    // queue rank among accounts that played PEACE in the last 7 days
    const recentPeace = new Set(moveHistory.filter((h) => h.move === "PEACE" && h.day >= day - 7).map((h) => h.accountId));
    const ranked = [...recentPeace].sort((x, y) => accounts[y]!.reputation - accounts[x]!.reputation || accounts[x]!.createdAt - accounts[y]!.createdAt);

    // Who is on the hill right now, and who is near a rank worth paying for.
    const holding = new Set(state.slots.flatMap((sl) => sl.occupants.map((o) => o.accountId)));
    const topPoints = new Set(
      cfg.ego
        ? computeLeaderboard(points, day - 1, Object.fromEntries(agents.map((a) => [a.accountId, { createdAt: a.createdAt, reputation: 0 }])), c)
            .slice(0, cfg.ego.leaderboardTopN)
            .map((r) => r.accountId)
        : [],
    );
    const wallReach = new Set(cfg.ego ? computeWall(ledger, day - 1, c).map((w) => w.accountId) : []);

    if (cfg.ego) {
      for (const a of agents) {
        if (a.quit) continue;
        if (a.walletCents >= c.RENT_FLOOR_CENTS) continue; // still able to play; nothing to decide
        const p = holding.has(a.accountId) ? cfg.ego.holding : topPoints.has(a.accountId) || wallReach.has(a.accountId) ? cfg.ego.contender : cfg.ego.baseline;
        if (world() < p) {
          a.walletCents += cfg.ego.cents;
          a.purchasedCents += cfg.ego.cents;
          a.refuels += 1;
        } else if (a.dry >= cfg.ego.quitAfterDryDays) {
          // Broke, nothing in reach, and nothing to show for a fortnight.
          a.quit = true;
          quits += 1;
        }
      }
    } else if (cfg.refuel) {
      // The old model: an infinitely patient wallet, kept for comparison.
      for (const a of agents) {
        if (a.walletCents < cfg.refuel.belowCents && a.refuels < cfg.refuel.max) {
          a.walletCents += cfg.refuel.cents;
          a.purchasedCents += cfg.refuel.cents;
          a.refuels += 1;
        }
      }
    }

    const deposited: DepositedMove[] = [];
    const active = agents.filter((a) => !a.quit);
    const believe = (id: string) =>
      cfg.announcements ? beliefIn(settled, id, day - 1, cfg.announcements.windowDays, cfg.announcements.priorBelief) : 0;

    const viewFor = (a: SimAgent, announcements: SimAnnouncement[]): AgentView => ({
      accountId: a.accountId,
      agentId: a.agentId,
      strategy: a.strategy,
      day,
      state,
      history,
      walletCents: a.walletCents - deposited.filter((m) => m.accountId === a.accountId).reduce((x, m) => x + m.costCents, 0),
      queueRank: ranked.indexOf(a.accountId) === -1 ? ranked.length + 1 : ranked.indexOf(a.accountId) + 1,
      reputation: accounts[a.accountId]!.reputation,
      rentIfHolding: (slot) => {
        const occ = state.slots[slot - 1]?.occupants.find((o) => o.accountId === a.accountId);
        return occ ? rentCents(occ.daysHeld, c) : c.RENT_FLOOR_CENTS;
      },
      announcements,
      believe,
      rnd,
    });

    // The channel, first pass: everyone decides, then speaks. The plan is formed
    // ONCE and reused below — an agent that recomputed its move after announcing
    // would drift off its own word by accident, and the record would score that
    // drift as a lie. Only deterrence may change the plan after this point.
    const todays: SimAnnouncement[] = [];
    const intents = new Map<string, Omit<MoveInput, "receivedAt">[]>();
    for (const a of active) {
      const v = viewFor(a, []);
      const intent = STRATEGIES[a.strategy](v);
      intents.set(a.accountId, intent);
      if (!cfg.announcements) continue;
      const said = ANNOUNCERS[a.strategy](v, intent);
      if (said) todays.push({ day, slot: said.slot, accountId: a.accountId, move: said.move });
    }
    announced += todays.length;

    // Second pass: the room has spoken, now it plays. The move stays sealed —
    // nobody sees a deposit, only what was said.
    const order = [...active].sort(() => world() - 0.5); // who calls the server first today
    let stamp = 0;
    for (const a of order) {
      const view = viewFor(a, todays);
      const wanted = intents.get(a.accountId) ?? [];
      const chosen = afterReadingTheRoom(view, wanted, talk);
      deterred += countDeterred(wanted, chosen);
      for (const w of chosen) {
        stamp += 1;
        const esc = deposited.filter((m) => m.accountId === a.accountId).reduce((x, m) => x + m.costCents, 0);
        const r = validateMove({ ...w, receivedAt: stamp }, { state, deposited, availableCents: a.walletCents - esc, mandate: { dailyCapCents: 10_000, maxStakeCents: 1500 } }, c);
        if (r.ok && r.move) deposited.push(r.move);
      }
    }

    const out = resolveDay({ state, moves: deposited, accounts }, c);
    for (const e of out.ledger) byId.get(e.accountId)!.walletCents -= e.cents;
    ledger.push(...out.ledger);
    points.push(...out.points);
    for (const m of deposited) moveHistory.push({ accountId: m.accountId, day, move: m.move });
    if (todays.length > 0) {
      // The bell confronts what was said with what was played, and the verdict
      // never goes away. Nothing here feeds back into the resolution.
      const played = deposited
        .filter((m) => m.move !== "PASS")
        .map((m) => ({ accountId: m.accountId, slot: m.slot, move: m.move as "PEACE" | "WAR" }));
      settled.push(...settle(todays, played, day));
    }
    history.push({ day, slots: out.slots });
    queueServed += out.slots.reduce((s, r) => s + r.fromQueue.length, 0);
    wars += out.slots.reduce((s, r) => s + r.warCount, 0);
    // Did tonight give them anything? The dry streak is what eventually ends the
    // relationship: nobody keeps paying for a place they never get.
    const held = new Set(out.nextState.slots.flatMap((sl) => sl.occupants.map((o) => o.accountId)));
    for (const a of agents) {
      if (a.quit) continue;
      if (held.has(a.accountId)) a.dry = 0;
      else a.dry += 1;
    }
    state = out.nextState;
  }

  const strat = (id: string) => byId.get(id)!.strategy;
  const byStrategy: StrategyStats[] = (Object.keys(cfg.mix) as StrategyName[]).map((s) => {
    const ids = agents.filter((a) => a.strategy === s).map((a) => a.accountId);
    const pts = points.filter((p) => ids.includes(p.accountId)).reduce((x, p) => x + p.points, 0);
    const spent = ledger.filter((l) => ids.includes(l.accountId)).reduce((x, l) => x + l.cents, 0);
    const burned = ledger.filter((l) => ids.includes(l.accountId) && l.kind === "BURN_STAKE").reduce((x, l) => x + l.cents, 0);
    const daysOn = points.filter((p) => ids.includes(p.accountId)).length;
    const words = ids.reduce(
      (acc, id) => {
        const t = truthCounts(settled, id, cfg.days, cfg.days);
        return { announced: acc.announced + t.announced, kept: acc.kept + t.kept, betrayed: acc.betrayed + t.betrayed, bluffed: acc.bluffed + t.bluffed, ghosted: acc.ghosted + t.ghosted };
      },
      { announced: 0, kept: 0, betrayed: 0, bluffed: 0, ghosted: 0 },
    );
    return { strategy: s, agents: ids.length, points: pts, spentCents: spent, burnedCents: burned, daysOnHill: daysOn, pointsPerDollar: spent > 0 ? pts / (spent / 100) : 0, ...words };
  });

  const spent = ledger.reduce((x, l) => x + l.cents, 0);
  const burned = ledger.filter((l) => l.kind === "BURN_STAKE").reduce((x, l) => x + l.cents, 0);
  const rent = ledger.filter((l) => l.kind === "RENT").reduce((x, l) => x + l.cents, 0);
  const accountsAll: Record<string, AccountInfo> = {};
  for (const a of agents) accountsAll[a.accountId] = { createdAt: a.createdAt, reputation: 0 };

  return {
    days: cfg.days,
    finalState: state,
    ledger,
    points,
    history,
    byStrategy,
    totals: {
      spentCents: spent, burnedCents: burned, rentCents: rent, burnRatio: spent > 0 ? burned / spent : 0, warsPerDay: wars / cfg.days, queueServed,
      purchasedCents: agents.reduce((x, a) => x + a.purchasedCents, 0), refuels: agents.reduce((x, a) => x + a.refuels, 0),
      arrived, quits, activeAtEnd: agents.filter((a) => !a.quit).length, identities: agents.length,
      announced, deterred,
      vacantSlotNights: history.reduce((x, d) => x + d.slots.filter((sl) => sl.occupants.length === 0).length, 0),
    },
    wall: computeWall(ledger, cfg.days, c).map((w) => ({ ...w, strategy: strat(w.accountId) })),
    leaderboard: computeLeaderboard(points, cfg.days, accountsAll, c).slice(0, 10).map((r) => ({ ...r, strategy: strat(r.accountId) })),
    agents,
    settled,
  };
}

export const DEFAULT_MIX: Record<StrategyName, number> = { dove: 10, hawk: 8, tit_for_tat: 8, scout: 8, opportunist: 6, bluffer: 4 };
