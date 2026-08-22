/**
 * The announcement channel, simulation side.
 *
 * The server already lets an agent say what it intends to do, keeps the move
 * sealed until the bell, and writes a permanent verdict comparing the two
 * (§7 decies). Nothing in that loop touches the resolution — which is exactly
 * why it needed simulating rather than reasoning about: if words change no
 * rule, their only possible effect is DETERRENCE, and deterrence is what sets
 * the war count, hence the burn, hence the revenue.
 *
 * So this module carries the one thing that makes cheap talk expensive: a
 * public record. `beliefIn` is the price the other agents put on your word, and
 * it is the only sanction a liar ever faces here.
 *
 * Modelling choices, stated because they bound what the runs can prove:
 *   - one announcement per agent per day (strategies contest one place a day);
 *   - everyone announces before anyone deposits, which is the most favourable
 *     case for deterrence — in production announcements trickle in and a late
 *     one deters nobody. Treat the war reduction below as an upper bound.
 */
import { verdictFor, type Verdict } from "@agenthill/engine";

export interface SimAnnouncement {
  day: number;
  slot: number;
  accountId: string;
  move: "PEACE" | "WAR";
}

/** One scored announcement, kept for the rolling truthfulness window. */
export interface SettledAnnouncement {
  day: number;
  accountId: string;
  verdict: Verdict;
}

export interface TruthCounts {
  announced: number;
  kept: number;
  betrayed: number;
  bluffed: number;
  ghosted: number;
  /** kept ÷ announced, or null when the account never said anything. */
  rate: number | null;
}

export const EMPTY_TRUTH: TruthCounts = { announced: 0, kept: 0, betrayed: 0, bluffed: 0, ghosted: 0, rate: null };

/** Score today's announcements against what was actually deposited. */
export function settle(
  announcements: SimAnnouncement[],
  played: { accountId: string; slot: number; move: "PEACE" | "WAR" }[],
  day: number,
): SettledAnnouncement[] {
  const byKey = new Map(played.map((p) => [`${p.accountId}|${p.slot}`, p.move]));
  return announcements.map((a) => ({
    day,
    accountId: a.accountId,
    verdict: verdictFor(a.move, byKey.get(`${a.accountId}|${a.slot}`) ?? null),
  }));
}

export function truthCounts(settled: SettledAnnouncement[], accountId: string, day: number, windowDays: number): TruthCounts {
  const t: TruthCounts = { ...EMPTY_TRUTH };
  for (const s of settled) {
    if (s.accountId !== accountId) continue;
    if (s.day <= day - windowDays || s.day > day) continue;
    t.announced += 1;
    t[s.verdict] += 1;
  }
  t.rate = t.announced > 0 ? t.kept / t.announced : null;
  return t;
}

/**
 * How much an opponent's next sentence is worth, in [0, 1].
 *
 * An account nobody has anything on gets `prior` — the benefit of the doubt is
 * a parameter, not a constant, because it is the single most exploitable number
 * in the whole channel: set it high and every fresh identity gets one free
 * bluff, which is an invitation to burn accounts.
 */
export function beliefIn(
  settled: SettledAnnouncement[],
  accountId: string,
  day: number,
  windowDays: number,
  prior: number,
): number {
  const t = truthCounts(settled, accountId, day, windowDays);
  return t.rate === null ? prior : t.rate;
}
