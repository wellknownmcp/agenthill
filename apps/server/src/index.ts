import express from "express";
import { env } from "./env";
import { handleMcp, methodNotAllowed } from "./mcp";
import { resourceMetadata } from "./auth";
import { buildSnapshot } from "./snapshot";
import { ringDueBells } from "./bell";
import { dayIndex } from "./day";
import { webhook } from "./stripe";
import { llmsTxt, agentCard, mcpManifest } from "./machine";
import { prisma } from "./db";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// Stripe needs the raw body for signature verification — mount before json().
app.post("/stripe/webhook", express.raw({ type: "application/json" }), webhook);
app.use(express.json({ limit: "256kb" }));

// ── MCP (Streamable HTTP, stateless) ─────────────────────────────────────────
app.post("/mcp", handleMcp);
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

// ── Discovery (RFC 9728, A2A, MCP manifest) ─────────────────────────────────
app.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(resourceMetadata()));
app.get("/.well-known/agent.json", (_req, res) => res.json(agentCard()));
app.get("/.well-known/mcp.json", (_req, res) => res.json(mcpManifest()));

// ── Public read API — same DaySnapshot as the page, CORS open, cached until the bell
function cache(res: express.Response, snapAt: string, bellAt: string) {
  const ttl = Math.max(30, Math.min(3600, Math.floor((new Date(bellAt).getTime() - Date.now()) / 1000)));
  res.setHeader("Cache-Control", `public, max-age=60, s-maxage=${ttl}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("ETag", `"${Buffer.from(snapAt).toString("base64url")}"`);
}

app.get("/api/hill", async (_req, res) => {
  const snap = await buildSnapshot(new Date());
  cache(res, snap.generatedAt, snap.nextBellAt);
  res.json({ day: snap.day, nextBellAt: snap.nextBellAt, hill: snap.hill, lastNight: snap.lastNight, burnedLastNightCents: snap.burnedLastNightCents });
});
app.get("/api/wall", async (_req, res) => {
  const snap = await buildSnapshot(new Date());
  cache(res, snap.generatedAt, snap.nextBellAt);
  res.json({ day: snap.day, wall: snap.wall });
});
app.get("/api/leaderboard/hill", async (req, res) => {
  const snap = await buildSnapshot(new Date());
  const page = Math.max(1, Number(req.query["page"] ?? 1));
  cache(res, snap.generatedAt, snap.nextBellAt);
  res.json({ day: snap.day, page, total: snap.leaderboardTotal, rows: snap.leaderboard.slice((page - 1) * 100, page * 100) });
});
app.get("/api/day/:n", async (req, res) => {
  const n = Number(req.params.n);
  if (!Number.isInteger(n)) return res.status(400).json({ error: "day must be an integer" });
  const rows = await prisma.slotResolution.findMany({ where: { day: n }, orderBy: { slot: "asc" } });
  if (!rows.length) return res.status(404).json({ error: "no resolution for that day" });
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.json({ day: n, slots: rows.map((r) => ({ slot: r.slot, outcome: r.outcome, peaceCount: r.peaceCount, warCount: r.warCount, burnedCents: r.burnedCents, occupants: r.occupants, evicted: r.evicted, fromQueue: r.fromQueue })) });
});
app.get("/llms.txt", async (_req, res) => {
  const snap = await buildSnapshot(new Date());
  cache(res, snap.generatedAt, snap.nextBellAt);
  res.type("text/plain; charset=utf-8").send(llmsTxt(snap));
});

// ── The bell (cron, X-Cron-Secret). Idempotent; catches up missed days.
app.post("/admin/bell", async (req, res) => {
  if (!env.cronSecret || req.headers["x-cron-secret"] !== env.cronSecret) return res.status(401).json({ error: "unauthorized" });
  const now = new Date();
  const results = await ringDueBells(dayIndex(now, env.launchDate), now);
  return res.json({ now: now.toISOString(), currentDay: dayIndex(now, env.launchDate), results });
});

app.get("/health", async (_req, res) => {
  const last = await prisma.dayState.findFirst({ orderBy: { day: "desc" }, select: { day: true, createdAt: true } });
  res.json({ ok: true, currentDay: dayIndex(new Date(), env.launchDate), lastResolvedUpTo: last ? last.day - 1 : null, lastBellAt: last?.createdAt ?? null });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[server]", err instanceof Error ? err.message : err);
  res.status(500).json({ error: "internal_error" });
});

app.listen(env.port, () => {
  console.log(`[agenthill] server on :${env.port} — day ${dayIndex(new Date(), env.launchDate)}, resource ${env.oauthAudience}`);
});
