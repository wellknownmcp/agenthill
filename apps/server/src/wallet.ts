/**
 * The ledger is the only source of truth for money. No denormalized balance.
 *   balance   = purchased credits + unexpired granted credits − all debits
 *   escrow    = cost of today's active moves
 *   available = balance − escrow
 *   granted   = unexpired grants − granted part of past debits (floor 0)
 */
import { prisma } from "./db";

export interface Wallet {
  balanceCents: number;
  escrowCents: number;
  availableCents: number;
  grantedCents: number;
  purchasedCents: number;
}

export async function wallet(accountId: string, day: number, now: Date): Promise<Wallet> {
  const [credits, debits, escrow] = await Promise.all([
    prisma.credit.findMany({ where: { accountId }, select: { source: true, cents: true, expiresAt: true } }),
    prisma.ledgerEntry.aggregate({ where: { accountId }, _sum: { cents: true, grantedCents: true } }),
    prisma.move.aggregate({ where: { accountId, day, status: "active" }, _sum: { costCents: true } }),
  ]);
  const purchased = credits.filter((c) => c.source === "purchase").reduce((s, c) => s + c.cents, 0);
  const grantsLive = credits.filter((c) => c.source === "grant" && (!c.expiresAt || c.expiresAt > now)).reduce((s, c) => s + c.cents, 0);
  const spent = debits._sum.cents ?? 0;
  const grantedUsed = debits._sum.grantedCents ?? 0;
  const escrowCents = escrow._sum.costCents ?? 0;
  const grantedCents = Math.max(0, grantsLive - grantedUsed);
  const balanceCents = purchased + grantsLive - spent;
  return { balanceCents, escrowCents, availableCents: balanceCents - escrowCents, grantedCents, purchasedCents: purchased };
}

/** Average daily spend over the last 7 resolved days, for `daysSurvivable`. */
export async function dailyBurn(accountId: string, day: number): Promise<number | null> {
  const rows = await prisma.ledgerEntry.aggregate({ where: { accountId, day: { gte: day - 7, lt: day } }, _sum: { cents: true }, _count: true });
  if (!rows._count) return null;
  return (rows._sum.cents ?? 0) / 7;
}

export function daysSurvivable(availableCents: number, burnPerDay: number | null): number | null {
  if (burnPerDay === null || burnPerDay <= 0) return null;
  return Math.floor(availableCents / burnPerDay);
}
