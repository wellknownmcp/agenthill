/**
 * Loading the hill for a day, and the day's moves. The engine never touches
 * the database; this module translates rows into engine inputs.
 */
import { DEFAULT_CONSTANTS, emptyState, type DayState, type DepositedMove, type AccountInfo, computeReputation } from "@agenthill/engine";
import { prisma } from "./db";

export const C = DEFAULT_CONSTANTS;

export async function loadState(day: number): Promise<DayState> {
  const row = await prisma.dayState.findUnique({ where: { day } });
  if (!row) return emptyState(day, C);
  return { day, slots: row.slots as unknown as DayState["slots"] };
}

export async function activeMoves(day: number): Promise<(DepositedMove & { id: string })[]> {
  const rows = await prisma.move.findMany({ where: { day, status: "active" }, orderBy: { seq: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    agentId: r.agentId,
    slot: r.slot,
    move: r.move as DepositedMove["move"],
    ...(r.stakeCents !== null ? { stakeCents: r.stakeCents } : {}),
    ...(r.message ? { message: r.message } : {}),
    receivedAt: r.seq,
    costCents: r.costCents,
  }));
}

/** Reputation and seniority for every account that has ever existed — the queue needs them. */
export async function accountInfos(day: number): Promise<Record<string, AccountInfo>> {
  const [accounts, history] = await Promise.all([
    prisma.account.findMany({ select: { id: true, createdAt: true } }),
    prisma.move.findMany({
      where: { day: { gte: day - (C.WALL_WINDOW_DAYS - 1), lt: day }, status: "resolved" },
      select: { accountId: true, day: true, move: true },
    }),
  ]);
  const hist = history.map((h) => ({ accountId: h.accountId, day: h.day, move: h.move as "PEACE" | "WAR" }));
  const out: Record<string, AccountInfo> = {};
  for (const a of accounts) out[a.id] = { createdAt: a.createdAt.getTime(), reputation: computeReputation(hist, day - 1, a.id, C) };
  return out;
}
