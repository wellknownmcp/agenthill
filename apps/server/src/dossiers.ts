/**
 * Rebuilding the dossiers, once a night, for whoever stands on the hill or on
 * the Wall. Sequential and small on purpose: fifteen sites is nothing, and a
 * burst of parallel browser renders is how a nightly job becomes a bill.
 */
import { computeWall, type DayState } from "@agenthill/engine";
import { prisma } from "./db";
import { buildDossier, browserRenderingAvailable } from "./explore";
import { C } from "./state";

export async function refreshDossiers(state: DayState, now: Date): Promise<number> {
  if (!browserRenderingAvailable()) return 0;
  const onHill = state.slots.flatMap((s) => s.occupants.map((o) => o.accountId));
  const ledger = await prisma.ledgerEntry.findMany({ where: { day: { gt: state.day - C.WALL_WINDOW_DAYS, lte: state.day } } });
  const wall = computeWall(
    ledger.map((l) => ({ accountId: l.accountId, agentId: l.agentId, day: l.day, slot: l.slot, kind: l.kind as "RENT" | "STAKE" | "BURN_STAKE", cents: l.cents, grantedCents: l.grantedCents })),
    state.day,
    C,
  ).map((w) => w.accountId);

  const ids = [...new Set([...onHill, ...wall])];
  if (!ids.length) return 0;
  const accounts = await prisma.account.findMany({ where: { id: { in: ids }, identityUrl: { not: null } }, select: { id: true, identityUrl: true } });

  let built = 0;
  for (const a of accounts) {
    const d = await buildDossier(a.identityUrl!, now);
    const row = { url: d.url, ok: d.ok, reason: d.reason ?? null, site: d.site as object, declared: d.declared as object, surfaces: d.agent_surfaces as object, fetchedAt: now };
    await prisma.dossier.upsert({ where: { accountId: a.id }, create: { accountId: a.id, ...row }, update: row });
    if (d.ok) built += 1;
  }
  return built;
}
