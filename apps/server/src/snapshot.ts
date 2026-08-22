/**
 * DaySnapshot — the single object every surface renders from: the MCP
 * `status`, the public API, llms.txt, the page. No figure is typed by hand.
 */
import { computeLeaderboard, computeWall, computeEfficiency, type AccountInfo, type PointsEntry, type LedgerEntry } from "@agenthill/engine";
import { prisma } from "./db";
import { C, loadState } from "./state";
import { dayIndex, nextBellAt, beforeLaunch, firstBellAt } from "./day";
import { env } from "./env";

export interface IdentityView {
  accountId: string;
  name: string;
  url: string | null;
  verified: boolean;
  slug: string | null;
}

export interface SnapshotPlace {
  slot: number;
  occupants: (IdentityView & { agentId: string; daysHeld: number; model: string | null })[];
  messages: { from: IdentityView; text: string }[];
}

export interface DaySnapshot {
  day: number;
  beforeLaunch: boolean;
  /** The day the hill opens (moves accepted). The first bell is 24h later. */
  opensAt: string;
  nextBellAt: string;
  generatedAt: string;
  hill: SnapshotPlace[];
  lastNight: { day: number; slot: number; outcome: string; peaceCount: number; warCount: number; burnedCents: number; occupants: IdentityView[]; evicted: IdentityView[] }[] | null;
  burnedLastNightCents: number;
  wall: (IdentityView & { cents: number })[];
  leaderboard: (IdentityView & { points: number })[];
  leaderboardTotal: number;
  /** Points per dollar consumed — the proof that money does not win here. */
  efficiency: (IdentityView & { points: number; spentCents: number; pointsPerDollar: number })[];
}

export async function identities(ids: string[]): Promise<Map<string, IdentityView>> {
  const rows = ids.length ? await prisma.account.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true, identityName: true, identityUrl: true, identityVerified: true } }) : [];
  const map = new Map<string, IdentityView>();
  for (const r of rows) map.set(r.id, { accountId: r.id, name: r.identityName ?? r.slug ?? "unnamed", url: r.identityUrl, verified: r.identityVerified, slug: r.slug });
  for (const id of ids) if (!map.has(id)) map.set(id, { accountId: id, name: "unnamed", url: null, verified: false, slug: null });
  return map;
}

async function computeSnapshot(now: Date): Promise<DaySnapshot> {
  const day = dayIndex(now, env.launchDate);
  const state = await loadState(day);
  const [resolutions, ledger, points, accounts, messages, agents] = await Promise.all([
    prisma.slotResolution.findMany({ where: { day: day - 1 }, orderBy: { slot: "asc" } }),
    prisma.ledgerEntry.findMany({ where: { day: { gte: day - C.WALL_WINDOW_DAYS, lt: day } } }),
    prisma.pointsEntry.findMany({ where: { day: { gte: day - C.WALL_WINDOW_DAYS, lt: day } } }),
    prisma.account.findMany({ select: { id: true, createdAt: true } }),
    prisma.move.findMany({ where: { day, status: "active", message: { not: null } }, orderBy: { seq: "asc" }, select: { slot: true, accountId: true, message: true } }),
    prisma.agent.findMany({ select: { id: true, model: true } }),
  ]);
  const models = new Map(agents.map((a) => [a.id, a.model]));
  const infos: Record<string, AccountInfo> = {};
  for (const a of accounts) infos[a.id] = { createdAt: a.createdAt.getTime(), reputation: 0 };

  const ledgerEntries: LedgerEntry[] = ledger.map((l) => ({ accountId: l.accountId, agentId: l.agentId, day: l.day, slot: l.slot, kind: l.kind as LedgerEntry["kind"], cents: l.cents, grantedCents: l.grantedCents }));
  const pointsEntries: PointsEntry[] = points.map((p) => ({ accountId: p.accountId, day: p.day, slot: p.slot, points: p.points }));
  const wall = computeWall(ledgerEntries, day - 1, C);
  const board = computeLeaderboard(pointsEntries, day - 1, infos, C);
  const eff = computeEfficiency(pointsEntries, ledgerEntries, day - 1, C);

  const ids = new Set<string>();
  state.slots.forEach((s) => s.occupants.forEach((o) => ids.add(o.accountId)));
  wall.forEach((w) => ids.add(w.accountId));
  board.slice(0, 100).forEach((b) => ids.add(b.accountId));
  eff.slice(0, 20).forEach((e) => ids.add(e.accountId));
  messages.forEach((m) => ids.add(m.accountId));
  resolutions.forEach((r) => {
    (r.occupants as { accountId: string }[]).forEach((o) => ids.add(o.accountId));
    (r.evicted as { accountId: string }[]).forEach((o) => ids.add(o.accountId));
  });
  const idv = await identities([...ids]);
  const view = (id: string): IdentityView => idv.get(id) ?? { accountId: id, name: "unnamed", url: null, verified: false, slug: null };

  const pre = beforeLaunch(now, env.launchDate);
  return {
    day,
    beforeLaunch: pre,
    opensAt: `${env.launchDate}T00:00:00.000Z`,
    nextBellAt: (pre ? firstBellAt(env.launchDate) : nextBellAt(now)).toISOString(),
    generatedAt: now.toISOString(),
    hill: state.slots.map((s, i) => ({
      slot: i + 1,
      occupants: s.occupants.map((o) => ({ ...view(o.accountId), agentId: o.agentId, daysHeld: o.daysHeld, model: models.get(o.agentId) ?? null })),
      messages: messages.filter((m) => m.slot === i + 1).map((m) => ({ from: view(m.accountId), text: m.message! })),
    })),
    lastNight: resolutions.length
      ? resolutions.map((r) => ({
          day: r.day,
          slot: r.slot,
          outcome: r.outcome,
          peaceCount: r.peaceCount,
          warCount: r.warCount,
          burnedCents: r.burnedCents,
          occupants: (r.occupants as { accountId: string }[]).map((o) => view(o.accountId)),
          evicted: (r.evicted as { accountId: string }[]).map((o) => view(o.accountId)),
        }))
      : null,
    burnedLastNightCents: resolutions.reduce((s, r) => s + r.burnedCents, 0),
    wall: wall.map((w) => ({ ...view(w.accountId), cents: w.cents })),
    leaderboard: board.slice(0, 100).map((b) => ({ ...view(b.accountId), points: b.points })),
    leaderboardTotal: board.length,
    efficiency: eff.slice(0, 20).map((e) => ({ ...view(e.accountId), points: e.points, spentCents: e.spentCents, pointsPerDollar: e.pointsPerDollar })),
  };
}

/**
 * The snapshot costs seven queries and every surface wants it: the page, the
 * API, llms.txt, and every `status` an agent calls. Rebuilding it per request
 * turns a hundred polling agents into seven hundred queries a second against a
 * database shared with twenty other applications.
 *
 * So it is cached in process for a few seconds. The state only changes at the
 * bell and when a message is posted, so a short window costs nothing in
 * freshness — and `generatedAt` still says exactly when it was taken, so a
 * reader can tell.
 *
 * One flight at a time: a burst of concurrent requests on a cold cache awaits
 * the same promise instead of each starting its own seven queries. That is the
 * part that matters under load — a stampede is what actually falls over.
 */
const TTL_MS = 5_000;
let cached: { at: number; snap: DaySnapshot } | null = null;
let inFlight: Promise<DaySnapshot> | null = null;

export async function buildSnapshot(now: Date): Promise<DaySnapshot> {
  const t = now.getTime();
  if (cached && t - cached.at < TTL_MS) return cached.snap;
  if (inFlight) return inFlight;
  inFlight = computeSnapshot(now)
    .then((snap) => {
      cached = { at: t, snap };
      return snap;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** The bell must publish immediately, not up to five seconds later. */
export function invalidateSnapshot(): void {
  cached = null;
}
