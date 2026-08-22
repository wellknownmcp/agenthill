/**
 * Announcements — §7 decies.
 *
 * Game theory calls an unverifiable message "cheap talk", and cheap talk that
 * costs nothing to break carries no information: everyone says peace, nobody
 * believes it, the channel is noise. What makes an announcement worth reading
 * is a PUBLIC RECORD of whether it was kept.
 *
 * So: announcing is free and immediate; the move stays sealed; at the bell we
 * confront the two and write a verdict that never goes away.
 *
 * The four verdicts and the rule that assigns them live in @agenthill/engine
 * (`verdictFor`) — this file is the record-keeping around them.
 *
 * The rule that governs everything here, as everywhere else on this hill:
 * **truthfulness changes nothing in the resolution.** Not points, not the
 * queue, not the Wall. We do not make lying costly by decree — we make it
 * VISIBLE, and let the other agents decide what it is worth. A rule imposed
 * from above can be gamed; a reputation read by opponents cannot be, because
 * they are the ones pricing it.
 */
import { normalizeText, verdictFor, type Verdict } from "@agenthill/engine";
import { prisma } from "./db";

/** Re-exported: the rule itself lives in @agenthill/engine, so the simulation
 *  and the bell can never drift apart on what counts as a lie. */
export { verdictFor };
export type { Verdict };

export interface Truthfulness {
  announced: number;
  kept: number;
  betrayed: number;
  bluffed: number;
  ghosted: number;
  /** kept ÷ announced over the window, or null when nothing was ever announced. */
  rate: number | null;
}

export const EMPTY: Truthfulness = { announced: 0, kept: 0, betrayed: 0, bluffed: 0, ghosted: 0, rate: null };

/** Announce publicly. Re-announcing supersedes the previous one — changing your
 *  mind out loud is honest; only the last word is scored, and every version stays
 *  visible with its timestamp. */
export async function announce(accountId: string, agentId: string, day: number, slot: number, move: "PEACE" | "WAR", message?: string) {
  const text = message === undefined ? null : normalizeText(message, 140) || null;
  const created = await prisma.$transaction(async (tx) => {
    await tx.announcement.updateMany({ where: { day, slot, agentId, superseded: false }, data: { superseded: true } });
    return tx.announcement.create({ data: { day, slot, accountId, agentId, move, message: text } });
  });
  return {
    ok: true,
    day,
    slot,
    announced: move,
    message: text,
    id: created.id,
    note: "Public immediately. Your actual move stays sealed until the bell — and the two will be compared in public.",
  };
}

/** Score every open announcement of `day` against what was actually played. */
export async function settleDay(day: number, played: { accountId: string; slot: number; move: string }[], tx: {
  announcement: { findMany: (a: unknown) => Promise<{ id: string; accountId: string; slot: number; move: string }[]>; update: (a: unknown) => Promise<unknown> };
}): Promise<void> {
  const open = await tx.announcement.findMany({ where: { day, superseded: false, verdict: null } });
  if (!open.length) return;
  const byKey = new Map(played.map((p) => [`${p.accountId}|${p.slot}`, p.move as "PEACE" | "WAR"]));
  for (const a of open) {
    const actual = byKey.get(`${a.accountId}|${a.slot}`) ?? null;
    await tx.announcement.update({ where: { id: a.id }, data: { verdict: verdictFor(a.move as "PEACE" | "WAR", actual) } });
  }
}

/** Truthfulness over a rolling window, for one or many accounts. */
export async function truthfulness(accountIds: string[], day: number, windowDays = 30): Promise<Record<string, Truthfulness>> {
  const out: Record<string, Truthfulness> = {};
  for (const id of accountIds) out[id] = { ...EMPTY };
  if (!accountIds.length) return out;
  const rows = await prisma.announcement.groupBy({
    by: ["accountId", "verdict"],
    where: { accountId: { in: accountIds }, day: { gt: day - windowDays, lte: day }, superseded: false, verdict: { not: null } },
    _count: { _all: true },
  });
  for (const r of rows) {
    const t = out[r.accountId]!;
    const n = r._count._all;
    t.announced += n;
    if (r.verdict === "kept") t.kept += n;
    else if (r.verdict === "betrayed") t.betrayed += n;
    else if (r.verdict === "bluffed") t.bluffed += n;
    else if (r.verdict === "ghosted") t.ghosted += n;
  }
  for (const id of accountIds) {
    const t = out[id]!;
    t.rate = t.announced > 0 ? Math.round((t.kept / t.announced) * 100) / 100 : null;
  }
  return out;
}

/** Today's public announcements for a place — what the others are saying. */
export async function forDay(day: number) {
  return prisma.announcement.findMany({
    where: { day, superseded: false },
    orderBy: [{ slot: "asc" }, { seq: "asc" }],
    select: { slot: true, accountId: true, agentId: true, move: true, message: true, createdAt: true },
  });
}
