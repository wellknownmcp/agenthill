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
import { STRATEGIES, type AgentView, type PublicDay, type StrategyName } from "./strategies";

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
}

export interface StrategyStats {
  strategy: StrategyName;
  agents: number;
  points: number;
  spentCents: number;
  burnedCents: number;
  daysOnHill: number;
  pointsPerDollar: number;
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
  };
  wall: { accountId: string; strategy: StrategyName; cents: number }[];
  leaderboard: { accountId: string; strategy: StrategyName; points: number }[];
  agents: SimAgent[];
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
  const rnd = lcg(cfg.seed);
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

  for (let day = 1; day <= cfg.days; day++) {
    // Arrivals: somebody read the journal and pointed an agent at the hill.
    if (cfg.arrivals && cfg.arrivals.perDay > 0 && day > 1) {
      const mix = cfg.arrivals.mix ?? cfg.mix;
      const names = Object.keys(mix) as StrategyName[];
      arrivalDebt += cfg.arrivals.perDay;
      while (arrivalDebt >= 1) {
        arrivalDebt -= 1;
        n += 1;
        const strategy = names[Math.floor(rnd() * names.length)] ?? names[0]!;
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
        if (rnd() < p) {
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
    const order = agents.filter((a) => !a.quit).sort(() => rnd() - 0.5); // who calls the server first today
    let stamp = 0;
    for (const a of order) {
      const escrow = deposited.filter((m) => m.accountId === a.accountId).reduce((s, m) => s + m.costCents, 0);
      const view: AgentView = {
        accountId: a.accountId,
        agentId: a.agentId,
        day,
        state,
        history,
        walletCents: a.walletCents - escrow,
        queueRank: ranked.indexOf(a.accountId) === -1 ? ranked.length + 1 : ranked.indexOf(a.accountId) + 1,
        reputation: accounts[a.accountId]!.reputation,
        rentIfHolding: (slot) => {
          const occ = state.slots[slot - 1]?.occupants.find((o) => o.accountId === a.accountId);
          return occ ? rentCents(occ.daysHeld, c) : c.RENT_FLOOR_CENTS;
        },
        rnd,
      };
      const wanted = STRATEGIES[a.strategy](view);
      for (const w of wanted) {
        stamp += 1;
        const esc = deposited.filter((m) => m.accountId === a.accountId).reduce((s, m) => s + m.costCents, 0);
        const r = validateMove({ ...w, receivedAt: stamp }, { state, deposited, availableCents: a.walletCents - esc, mandate: { dailyCapCents: 10_000, maxStakeCents: 1500 } }, c);
        if (r.ok && r.move) deposited.push(r.move);
      }
    }

    const out = resolveDay({ state, moves: deposited, accounts }, c);
    for (const e of out.ledger) byId.get(e.accountId)!.walletCents -= e.cents;
    ledger.push(...out.ledger);
    points.push(...out.points);
    for (const m of deposited) moveHistory.push({ accountId: m.accountId, day, move: m.move });
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
    return { strategy: s, agents: ids.length, points: pts, spentCents: spent, burnedCents: burned, daysOnHill: daysOn, pointsPerDollar: spent > 0 ? pts / (spent / 100) : 0 };
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
      vacantSlotNights: history.reduce((x, d) => x + d.slots.filter((sl) => sl.occupants.length === 0).length, 0),
    },
    wall: computeWall(ledger, cfg.days, c).map((w) => ({ ...w, strategy: strat(w.accountId) })),
    leaderboard: computeLeaderboard(points, cfg.days, accountsAll, c).slice(0, 10).map((r) => ({ ...r, strategy: strat(r.accountId) })),
    agents,
  };
}

export const DEFAULT_MIX: Record<StrategyName, number> = { dove: 10, hawk: 8, tit_for_tat: 8, scout: 8, opportunist: 6 };
