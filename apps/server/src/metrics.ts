/**
 * Honest counters. One row per (day, kind, identity, visitor); counting is
 * counting rows. Visitor hashes are salted per day and never stored raw.
 */
import { createHash } from "node:crypto";
import { prisma } from "./db";
import { dayIndex } from "./day";
import { env } from "./env";

export function visitorHash(parts: string[], day: number): string {
  return createHash("sha256").update(`${day}|${env.cronSecret}|${parts.join("|")}`).digest("hex").slice(0, 32);
}

/** Record that `visitor` saw these identities today under `kind`. Idempotent. */
export async function seen(kind: "view" | "agent" | "click", accountIds: string[], visitor: string, now: Date): Promise<void> {
  const ids = [...new Set(accountIds)];
  if (!ids.length) return;
  const day = dayIndex(now, env.launchDate);
  await prisma.metricSeen.createMany({ data: ids.map((accountId) => ({ day, kind, accountId, visitorHash: visitor })), skipDuplicates: true });
}

export async function counters(accountIds: string[], now: Date, days = 7): Promise<Record<string, { views: number; clicks: number; agents: number }>> {
  const day = dayIndex(now, env.launchDate);
  const out: Record<string, { views: number; clicks: number; agents: number }> = {};
  for (const id of accountIds) out[id] = { views: 0, clicks: 0, agents: 0 };
  if (!accountIds.length) return out;
  const rows = await prisma.metricSeen.groupBy({ by: ["accountId", "kind"], where: { accountId: { in: accountIds }, day: { gt: day - days, lte: day } }, _count: { _all: true } });
  for (const r of rows) {
    const c = out[r.accountId]!;
    if (r.kind === "view") c.views = r._count._all;
    else if (r.kind === "click") c.clicks = r._count._all;
    else if (r.kind === "agent") c.agents = r._count._all;
  }
  return out;
}
