import type { Constants } from "./constants";
import { DEFAULT_CONSTANTS } from "./constants";
import type { AccountInfo, LedgerEntry, MoveKind, PointsEntry } from "./types";

export interface WallRow {
  accountId: string;
  /** Real money only: cents − grantedCents over the window. */
  cents: number;
}

export interface LeaderboardRow {
  accountId: string;
  points: number;
}

export interface EfficiencyRow {
  accountId: string;
  points: number;
  /** Credits consumed over the window — granted ones included. */
  spentCents: number;
  /** Points per dollar consumed. The proof that money does not win here. */
  pointsPerDollar: number;
}

export interface MoveHistoryEntry {
  accountId: string;
  day: number;
  move: MoveKind;
}

function windowStart(day: number, c: Constants): number {
  return day - (c.WALL_WINDOW_DAYS - 1);
}

/**
 * The Wall: top accounts by REAL money spent over the rolling window. Burned
 * stakes count; granted credits never do. Ties go to the account that reached
 * its total first (the position of its last contributing ledger line).
 */
export function computeWall(ledger: LedgerEntry[], day: number, c: Constants = DEFAULT_CONSTANTS): WallRow[] {
  const from = windowStart(day, c);
  const totals = new Map<string, { cents: number; reachedDay: number; reachedIdx: number }>();
  ledger.forEach((e, idx) => {
    if (e.day < from || e.day > day) return;
    const real = e.cents - e.grantedCents;
    if (real <= 0) return;
    const t = totals.get(e.accountId) ?? { cents: 0, reachedDay: -Infinity, reachedIdx: -1 };
    t.cents += real;
    if (e.day > t.reachedDay || (e.day === t.reachedDay && idx > t.reachedIdx)) {
      t.reachedDay = e.day;
      t.reachedIdx = idx;
    }
    totals.set(e.accountId, t);
  });
  return [...totals.entries()]
    .sort((a, b) => b[1].cents - a[1].cents || a[1].reachedDay - b[1].reachedDay || a[1].reachedIdx - b[1].reachedIdx || cmp(a[0], b[0]))
    .slice(0, c.WALL_SLOTS)
    .map(([accountId, t]) => ({ accountId, cents: t.cents }));
}

/**
 * The Leaderboard: every known account, by hill points over the rolling window
 * (zeros included), ties by seniority. Money never enters this function.
 */
export function computeLeaderboard(points: PointsEntry[], day: number, accounts: Record<string, AccountInfo>, c: Constants = DEFAULT_CONSTANTS): LeaderboardRow[] {
  const from = windowStart(day, c);
  return rank(points.filter((p) => p.day >= from && p.day <= day), accounts);
}

/** Hall of Fame: lifetime points, same ordering rules. */
export function computeHallOfFame(points: PointsEntry[], accounts: Record<string, AccountInfo>): LeaderboardRow[] {
  return rank(points, accounts);
}

function rank(points: PointsEntry[], accounts: Record<string, AccountInfo>): LeaderboardRow[] {
  const totals = new Map<string, number>();
  for (const id of Object.keys(accounts)) totals.set(id, 0);
  for (const p of points) totals.set(p.accountId, (totals.get(p.accountId) ?? 0) + p.points);
  const created = (id: string) => accounts[id]?.createdAt ?? Number.MAX_SAFE_INTEGER;
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || created(a[0]) - created(b[0]) || cmp(a[0], b[0]))
    .map(([accountId, pts]) => ({ accountId, points: pts }));
}

/**
 * Reputation: share of PEACE among an account's PEACE/WAR moves over the rolling
 * window. 0 without history — a newcomer has nothing to show yet.
 */
export function computeReputation(history: MoveHistoryEntry[], day: number, accountId: string, c: Constants = DEFAULT_CONSTANTS): number {
  const from = windowStart(day, c);
  let peace = 0;
  let total = 0;
  for (const h of history) {
    if (h.accountId !== accountId || h.day < from || h.day > day || h.move === "PASS") continue;
    total += 1;
    if (h.move === "PEACE") peace += 1;
  }
  return total === 0 ? 0 : peace / total;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Points per dollar — the second crown.
 *
 * The hill claims a poor agent can beat a rich one; this is the number that
 * makes the claim checkable, and it lets somebody be first at something without
 * ever holding place 1.
 *
 * The denominator is everything consumed, granted credits included: this
 * measures skill at the game, not the size of a wallet. Real money is the Wall's
 * business, and the two must not be confused.
 */
export function computeEfficiency(
  points: PointsEntry[],
  ledger: LedgerEntry[],
  day: number,
  c: Constants = DEFAULT_CONSTANTS,
): EfficiencyRow[] {
  const from = windowStart(day, c);
  const pts = new Map<string, number>();
  const spent = new Map<string, number>();
  for (const p of points) {
    if (p.day < from || p.day > day) continue;
    pts.set(p.accountId, (pts.get(p.accountId) ?? 0) + p.points);
  }
  for (const e of ledger) {
    if (e.day < from || e.day > day) continue;
    spent.set(e.accountId, (spent.get(e.accountId) ?? 0) + e.cents);
  }
  const rows: EfficiencyRow[] = [];
  for (const [accountId, cents] of spent) {
    if (cents < c.EFFICIENCY_MIN_SPEND_CENTS) continue;
    const p = pts.get(accountId) ?? 0;
    rows.push({ accountId, points: p, spentCents: cents, pointsPerDollar: Math.round((p / (cents / 100)) * 100) / 100 });
  }
  return rows.sort((a, b) => b.pointsPerDollar - a.pointsPerDollar || b.points - a.points || cmp(a.accountId, b.accountId));
}
