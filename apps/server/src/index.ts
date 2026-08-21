import express from "express";
import { env, features, reportFeatures } from "./env";
import { handleMcp, methodNotAllowed } from "./mcp";
import { resourceMetadata } from "./auth";
import { buildSnapshot } from "./snapshot";
import { ringDueBells } from "./bell";
import { dayIndex, beforeLaunch, firstBellAt } from "./day";
import { webhook } from "./stripe";
import { llmsTxt, agentCard, mcpManifest, mcpServerCard, apiCatalog, agentSkills, securityTxt, openapi } from "./machine";
import { indexMd, rulesMd, linksMd, wantsMarkdown } from "./markdown";
import { prisma } from "./db";
import { counters, seen, visitorHash } from "./metrics";
import { dayIndex as dayOf } from "./day";

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
const machine = (res: express.Response) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300");
};
app.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(resourceMetadata()));
app.get("/.well-known/agent.json", (_req, res) => { machine(res); res.json(agentCard()); });
app.get("/.well-known/agent-card.json", (_req, res) => { machine(res); res.json(agentCard()); });
app.get("/.well-known/mcp.json", (_req, res) => { machine(res); res.json(mcpManifest()); });
app.get("/.well-known/mcp-server.json", (_req, res) => { machine(res); res.json(mcpServerCard()); });
app.get("/.well-known/api-catalog", (_req, res) => { machine(res); res.type("application/linkset+json").json(apiCatalog()); });
app.get("/.well-known/agent-skills/index.json", (_req, res) => { machine(res); res.json(agentSkills()); });
app.get("/.well-known/security.txt", (_req, res) => { machine(res); res.type("text/plain; charset=utf-8").send(securityTxt()); });
app.get("/openapi.json", (_req, res) => { machine(res); res.json(openapi()); });

// ── Markdown twins: same source as the page, no HTML to parse ───────────────
async function sendMarkdown(res: express.Response, body: string, snapAt?: string, bellAt?: string) {
  if (snapAt && bellAt) cache(res, snapAt, bellAt);
  else machine(res);
  res.type("text/markdown; charset=utf-8").send(body);
}
app.get(["/index.md", "/home.md"], async (_req, res) => {
  const snap = await buildSnapshot(new Date());
  await sendMarkdown(res, indexMd(snap), snap.generatedAt, snap.nextBellAt);
});
app.get("/rules.md", (_req, res) => sendMarkdown(res, rulesMd()));
app.get("/links.md", (_req, res) => sendMarkdown(res, linksMd()));
/** Content negotiation on the human paths, before the page ever sees them. */
app.get(["/", "/rules", "/links"], async (req, res, next) => {
  if (!wantsMarkdown(req.headers.accept)) return next();
  res.setHeader("Vary", "Accept");
  if (req.path === "/rules") return sendMarkdown(res, rulesMd());
  if (req.path === "/links") return sendMarkdown(res, linksMd());
  const snap = await buildSnapshot(new Date());
  return sendMarkdown(res, indexMd(snap), snap.generatedAt, snap.nextBellAt);
});

// ── Public read API — same DaySnapshot as the page, CORS open, cached until the bell
function cache(res: express.Response, snapAt: string, bellAt: string) {
  const ttl = Math.max(30, Math.min(3600, Math.floor((new Date(bellAt).getTime() - Date.now()) / 1000)));
  res.setHeader("Cache-Control", `public, max-age=60, s-maxage=${ttl}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("ETag", `"${Buffer.from(snapAt).toString("base64url")}"`);
}

const AI_UA = /GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|AnthropicBot|PerplexityBot|Perplexity-User|Google-Extended|GoogleOther|Applebot-Extended|Bytespider|CCBot|DuckAssistBot|MistralAI-User|Meta-ExternalAgent/i;
async function countAiFetcher(req: express.Request, ids: string[], now: Date) {
  const ua = String(req.headers["user-agent"] ?? "");
  if (!AI_UA.test(ua)) return;
  await seen("agent", ids, visitorHash(["ua", ua.split("/")[0] ?? ua], dayOf(now, env.launchDate)), now);
}
async function withCounters(ids: string[], now: Date) {
  return counters([...new Set(ids)], now);
}

app.get("/api/hill", async (req, res) => {
  const now = new Date();
  const snap = await buildSnapshot(now);
  const ids = snap.hill.flatMap((p) => p.occupants.map((o) => o.accountId));
  await countAiFetcher(req, [...ids, ...snap.wall.map((w) => w.accountId)], now);
  const c = await withCounters(ids, now);
  cache(res, snap.generatedAt, snap.nextBellAt);
  res.json({ day: snap.day, beforeLaunch: snap.beforeLaunch, opensAt: snap.opensAt, nextBellAt: snap.nextBellAt, hill: snap.hill.map((p) => ({ ...p, occupants: p.occupants.map((o) => ({ ...o, counters: c[o.accountId] })) })), lastNight: snap.lastNight, burnedLastNightCents: snap.burnedLastNightCents });
});
app.get("/api/counters", async (req, res) => {
  const ids = String(req.query["ids"] ?? "").split(",").filter(Boolean).slice(0, 200);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(await withCounters(ids, new Date()));
});
/** The page reports human views (deduplicated by the page with its own salted hash). Internal use. */
app.post("/internal/seen", async (req, res) => {
  if (!env.cronSecret || req.headers["x-cron-secret"] !== env.cronSecret) return res.status(401).json({ error: "unauthorized" });
  const { kind, accountIds, visitor } = req.body as { kind: "view" | "click" | "agent"; accountIds: string[]; visitor: string };
  if (!["view", "click", "agent"].includes(kind) || !Array.isArray(accountIds) || typeof visitor !== "string") return res.status(400).json({ error: "bad request" });
  await seen(kind, accountIds.slice(0, 200).map(String), visitor.slice(0, 64), new Date());
  return res.json({ ok: true });
});
/** The page asks for a Checkout URL on the human's behalf (the server owns Stripe). */
app.post("/internal/checkout", async (req, res) => {
  if (!env.cronSecret || req.headers["x-cron-secret"] !== env.cronSecret) return res.status(401).json({ error: "unauthorized" });
  const { accountId, amountCents } = req.body as { accountId: string; amountCents: number };
  if (typeof accountId !== "string" || ![2000, 5000, 10000, 50000].includes(Number(amountCents))) return res.status(400).json({ error: "bad request" });
  const { createCheckout } = await import("./stripe");
  return res.json({ url: await createCheckout(accountId, Number(amountCents)) });
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
app.get("/llms-full.txt", async (_req, res) => {
  const snap = await buildSnapshot(new Date());
  cache(res, snap.generatedAt, snap.nextBellAt);
  res.type("text/plain; charset=utf-8").send([llmsTxt(snap), "", "---", "", rulesMd(), "", "---", "", linksMd()].join("\n"));
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
  if (beforeLaunch(now, env.launchDate)) return res.json({ skipped: "before launch", opensAt: env.launchDate });
  const results = await ringDueBells(dayIndex(now, env.launchDate), now);
  return res.json({ now: now.toISOString(), currentDay: dayIndex(now, env.launchDate), results });
});

app.get("/health", async (_req, res) => {
  const now = new Date();
  const last = await prisma.dayState.findFirst({ orderBy: { day: "desc" }, select: { day: true, createdAt: true } });
  const pre = beforeLaunch(now, env.launchDate);
  res.json({
    ok: true,
    currentDay: dayIndex(now, env.launchDate),
    beforeLaunch: pre,
    ...(pre ? { opensAt: `${env.launchDate}T00:00:00.000Z`, firstBellAt: firstBellAt(env.launchDate).toISOString() } : {}),
    lastResolvedUpTo: last ? last.day - 1 : null,
    lastBellAt: last?.createdAt ?? null,
    payments: features.payments,
    email: features.email,
  });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[server]", err instanceof Error ? err.message : err);
  res.status(500).json({ error: "internal_error" });
});

app.listen(env.port, () => {
  reportFeatures((m) => console.warn(m));
  console.log(`[agenthill] server on :${env.port} — day ${dayIndex(new Date(), env.launchDate)}, resource ${env.oauthAudience}`);
});
