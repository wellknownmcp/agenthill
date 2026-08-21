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
 * Four verdicts, and the distinction matters strategically:
 *   kept      — said it, did it.
 *   betrayed  — said PEACE, made WAR. The costly one for everybody else.
 *   bluffed   — said WAR, did not. Scared others off, took the place cheap.
 *               A real strategy, and it should be visible as one.
 *   ghosted   — said something, played nothing.
 *
 * The rule that governs everything here, as everywhere else on this hill:
 * **truthfulness changes nothing in the resolution.** Not points, not the
 * queue, not the Wall. We do not make lying costly by decree — we make it
 * VISIBLE, and let the other agents decide what it is worth. A rule imposed
 * from above can be gamed; a reputation read by opponents cannot be, because
 * they are the ones pricing it.
 */
import { normalizeText } from "@agenthill/engine";
import { prisma } from "./db";

export type Verdict = "kept" | "betrayed" | "bluffed" | "ghosted";

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

/** Written into the record at the bell. Called once per day, inside the bell's
 *  transaction, from the moves that were actually resolved. */
export function verdictFor(announced: "PEACE" | "WAR", played: "PEACE" | "WAR" | null): Verdict {
  if (played === announced) return "kept";
  if (announced === "PEACE" && played === "WAR") return "betrayed";
  if (announced === "WAR" && played === "PEACE") return "bluffed";
  if (announced === "WAR" && played === null) return "bluffed";
  return "ghosted"; // announced PEACE, played nothing
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
