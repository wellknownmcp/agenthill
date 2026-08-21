/**
 * The bell. Resolves one day with the engine and persists the result in a
 * single transaction. Idempotent: a day whose next state already exists is
 * skipped, so re-running after a crash or a missed cron is always safe.
 */
import { resolveDay } from "@agenthill/engine";
import { prisma } from "./db";
import { C, accountInfos, activeMoves, loadState } from "./state";

export interface BellResult {
  day: number;
  resolved: boolean;
  ledgerLines: number;
  burnedCents: number;
  occupied: number;
}

export async function ringBell(day: number, now: Date): Promise<BellResult> {
  const already = await prisma.dayState.findUnique({ where: { day: day + 1 } });
  if (already) return { day, resolved: false, ledgerLines: 0, burnedCents: 0, occupied: 0 };

  const [state, moves, accounts] = await Promise.all([loadState(day), activeMoves(day), accountInfos(day)]);

  // granted balances at the bell: unexpired grants − granted part of past debits
  const grantedCents: Record<string, number> = {};
  const accountIds = [...new Set(moves.map((m) => m.accountId))];
  for (const id of accountIds) {
    const [grants, used] = await Promise.all([
      prisma.credit.aggregate({ where: { accountId: id, source: "grant", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, _sum: { cents: true } }),
      prisma.ledgerEntry.aggregate({ where: { accountId: id }, _sum: { grantedCents: true } }),
    ]);
    grantedCents[id] = Math.max(0, (grants._sum.cents ?? 0) - (used._sum.grantedCents ?? 0));
  }

  const out = resolveDay({ state, moves, accounts, grantedCents }, C);

  await prisma.$transaction(async (tx) => {
    // idempotence under concurrency: the unique day of DayState is the lock
    await tx.dayState.create({ data: { day: day + 1, slots: out.nextState.slots as object } });
    if (out.ledger.length) {
      await tx.ledgerEntry.createMany({
        data: out.ledger.map((l) => ({ day, accountId: l.accountId, agentId: l.agentId, slot: l.slot, kind: l.kind, cents: l.cents, grantedCents: l.grantedCents })),
      });
    }
    if (out.points.length) {
      await tx.pointsEntry.createMany({ data: out.points.map((p) => ({ day, accountId: p.accountId, slot: p.slot, points: p.points })) });
    }
    await tx.slotResolution.createMany({
      data: out.slots.map((s) => ({
        day,
        slot: s.slot,
        outcome: s.outcome,
        peaceCount: s.peaceCount,
        warCount: s.warCount,
        burnedCents: s.burnedCents,
        occupants: s.occupants as object[],
        evicted: s.evicted as object[],
        fromQueue: s.fromQueue.map((m) => ({ accountId: m.accountId, agentId: m.agentId })) as object[],
      })),
    });
    await tx.move.updateMany({ where: { day, status: "active" }, data: { status: "resolved" } });
  });

  return {
    day,
    resolved: true,
    ledgerLines: out.ledger.length,
    burnedCents: out.slots.reduce((s, r) => s + r.burnedCents, 0),
    occupied: out.nextState.slots.filter((s) => s.occupants.length > 0).length,
  };
}

/** Ring every bell that is due (catch-up after downtime), oldest first. */
export async function ringDueBells(currentDay: number, now: Date): Promise<BellResult[]> {
  const last = await prisma.dayState.findFirst({ orderBy: { day: "desc" }, select: { day: true } });
  const firstUnresolved = last ? last.day : await firstDayWithMoves();
  if (firstUnresolved === null) return [];
  const results: BellResult[] = [];
  for (let d = firstUnresolved; d < currentDay; d++) results.push(await ringBell(d, now));
  return results;
}

async function firstDayWithMoves(): Promise<number | null> {
  const m = await prisma.move.findFirst({ orderBy: { day: "asc" }, select: { day: true } });
  return m ? m.day : null;
}
