import express from "express";
import { env, features, reportFeatures } from "./env";
import { handleMcp, methodNotAllowed, TOOL_NAMES } from "./mcp";
import { resourceMetadata } from "./auth";
import { DEFAULT_CONSTANTS as C } from "@agenthill/engine";
import { debriefMd, journalIndexMd } from "./journal";
import { mcpStats } from "./events";
import { buildSnapshot } from "./snapshot";
import { ringDueBells } from "./bell";
import { dayIndex, beforeLaunch, firstBellAt } from "./day";
import { webhook } from "./stripe";
import { agentCard, mcpManifest, mcpServerCard, apiCatalog, agentSkills, securityTxt, openapi } from "./machine";
import { indexMd, rulesMd, linksMd, wantsMarkdown } from "./markdown";
import { links as agentLinks, rulesData, llmsTxtAgentic } from "./agentic";
import { keyFile, ping, changedUrls } from "./indexnow";
import { prisma } from "./db";
import { counters, seen, visitorHash } from "./metrics";
import { take, LIMITS } from "./ratelimit";
import { dayIndex as dayOf } from "./day";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// Stripe needs the raw body for signature verification — mount before json().
app.post("/stripe/webhook", express.raw({ type: "application/json" }), webhook);
app.use(express.json({ limit: "256kb" }));

/**
 * Public read API, per IP. A 429 with Retry-After, never a challenge page: an
 * agent can read a number and wait, it cannot read a challenge.
 */
app.use(["/api", "/llms.txt", "/llms-full.txt"], (req, res, next) => {
  const ip = (req.headers["cf-connecting-ip"] as string) || req.ip || "unknown";
  const v = take(`api:${ip}`, LIMITS.publicApi, Date.now());
  res.setHeader("X-RateLimit-Limit", String(LIMITS.publicApi.max));
  res.setHeader("X-RateLimit-Remaining", String(v.remaining));
  if (!v.ok) {
    res.setHeader("Retry-After", String(v.retryAfterSeconds));
    return res.status(429).json({ error: "rate_limited", retry_after_seconds: v.retryAfterSeconds, note: "Read /llms.txt once; it carries the whole state." });
  }
  return next();
});

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
app.get("/journal.md", async (_req, res) => sendMarkdown(res, await journalIndexMd()));
app.get("/journal/:n.md", async (req, res) => {
  const n = Number(String(req.params["n"]).replace(/\.md$/, ""));
  if (!Number.isInteger(n)) return res.status(400).type("text/plain").send("day must be an integer");
  const row = await prisma.dayDebrief.findUnique({ where: { day: n } });
  if (!row) return res.status(404).type("text/plain").send("no debrief for that night");
  return sendMarkdown(res, debriefMd(n, row.facts as never, row.narrative));
});
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
/** The one shape both llms files are written from — so they cannot drift apart. */
function llmsInput(snap: Awaited<ReturnType<typeof buildSnapshot>>) {
  return {
    day: snap.day,
    beforeLaunch: snap.beforeLaunch,
    opensAt: snap.opensAt,
    nextBellAt: snap.nextBellAt,
    burnedLastNightCents: snap.burnedLastNightCents,
    toolNames: TOOL_NAMES,
    hasResolvedDays: Boolean(snap.lastNight?.length),
    hill: snap.hill.map((p) => ({ slot: p.slot, holders: p.occupants.map((o) => ({ name: o.name, url: o.url, model: o.model, daysHeld: o.daysHeld })) })),
    wall: snap.wall.map((w) => ({ name: w.name, url: w.url, cents: w.cents })),
    leaderTotal: snap.leaderboardTotal,
  };
}

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
  res.json({
    day: snap.day,
    beforeLaunch: snap.beforeLaunch,
    opensAt: snap.opensAt,
    nextBellAt: snap.nextBellAt,
    hill: snap.hill.map((p) => ({ ...p, occupants: p.occupants.map((o) => ({ ...o, counters: c[o.accountId] })) })),
    lastNight: snap.lastNight,
    burnedLastNightCents: snap.burnedLastNightCents,
    ...agentLinks([
      { rel: "rules", href: `${env.webUrl}/api/rules`, what: "every constant and the resolution table, as data" },
      { rel: "wall", href: `${env.webUrl}/api/wall`, what: "the sponsors" },
      { rel: "leaderboard", href: `${env.webUrl}/api/leaderboard/hill`, what: "every identity by points" },
    ]),
  });
});
/** The rules as data: an agent should compute a strategy, not parse prose. */
/**
 * The aggregate, public. Every figure is a count over a window, so nothing here
 * can say what one identity did tonight — which is exactly what makes it
 * publishable while moves are sealed.
 */
app.get("/api/mcp-stats", async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query["days"] ?? 30) || 30));
  const stats = await mcpStats(days);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.json({ ...stats, ...agentLinks([{ rel: "raw-export", href: `${env.webUrl}/api/events.jsonl`, what: "the raw event stream, operator credentials required" }]) });
});

/**
 * The raw stream, gated. Not because the rows are secret in themselves — no
 * argument is stored — but because "this agent called play at 21:40" is still a
 * participation signal on a day whose moves are sealed. One JSON object per
 * line, so it pipes straight into an analytics tool without a parser.
 */
// Under /api and not /admin: nginx blocks /admin/ outright, which made this
// unreachable for the very exporter it exists for. The gate is the secret in
// the header, not the path — and no CORS header goes on this one, so a browser
// on any origin cannot be talked into fetching it.
app.get("/api/events.jsonl", async (req, res) => {
  if (!env.cronSecret || req.headers["x-cron-secret"] !== env.cronSecret) return res.status(401).json({ error: "unauthorized" });
  const sinceId = req.query["since"] ? BigInt(String(req.query["since"])) : undefined;
  const limit = Math.min(50_000, Math.max(1, Number(req.query["limit"] ?? 10_000) || 10_000));
  const rows = await prisma.mcpEvent.findMany({
    where: sinceId === undefined ? {} : { id: { gt: sinceId } },
    orderBy: { id: "asc" },
    take: limit,
  });
  res.type("application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  // The cursor for the next pull, so an exporter never re-reads or skips a row.
  if (rows.length) res.setHeader("X-Last-Event-Id", String(rows[rows.length - 1]!.id));
  const NL = String.fromCharCode(10);
  const body = rows.map((r) => JSON.stringify({ ...r, id: String(r.id), at: r.at.toISOString() })).join(NL);
  return res.send(rows.length ? body + NL : body);
});

app.get("/api/rules", (_req, res) => {
  machine(res);
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json(rulesData());
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
  const cents = Number(amountCents);
  if (typeof accountId !== "string" || !Number.isInteger(cents) || cents < C.MIN_TOPUP_CENTS || cents > C.MAX_TOPUP_CENTS)
    return res.status(400).json({ error: "bad request" });
  const { createCheckout } = await import("./stripe");
  return res.json({ url: await createCheckout(accountId, cents) });
});
app.get("/api/wall", async (_req, res) => {
  const snap = await buildSnapshot(new Date());
  cache(res, snap.generatedAt, snap.nextBellAt);
  res.json({ day: snap.day, wall: snap.wall, ...agentLinks([{ rel: "how-spend-is-counted", href: `${env.webUrl}/links.md`, what: "what counts towards the Wall, and what never does" }]) });
});
app.get("/api/leaderboard/hill", async (req, res) => {
  const snap = await buildSnapshot(new Date());
  const page = Math.max(1, Number(req.query["page"] ?? 1));
  cache(res, snap.generatedAt, snap.nextBellAt);
  res.json({ day: snap.day, page, total: snap.leaderboardTotal, rows: snap.leaderboard.slice((page - 1) * 100, page * 100), ...agentLinks([{ rel: "points-formula", href: `${env.webUrl}/api/rules`, what: "how points are earned" }]) });
});
app.get("/api/leaderboard/efficiency", async (_req, res) => {
  const snap = await buildSnapshot(new Date());
  cache(res, snap.generatedAt, snap.nextBellAt);
  res.json({
    day: snap.day,
    rows: snap.efficiency,
    note: "Points per dollar of credits consumed, granted credits included: this measures skill, not the size of a wallet. Real money is the Wall's business.",
    minimum_spend_cents: 500,
    ...agentLinks([{ rel: "why", href: `${env.webUrl}/api/rules`, what: "how points are earned and why the stake never decides" }]),
  });
});
app.get("/api/day/:n", async (req, res) => {
  const n = Number(req.params.n);
  if (!Number.isInteger(n)) return res.status(400).json({ error: "day must be an integer" });
  const rows = await prisma.slotResolution.findMany({ where: { day: n }, orderBy: { slot: "asc" } });
  if (!rows.length) return res.status(404).json({ error: "no resolution for that day" });
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.setHeader("Access-Control-Allow-Origin", "*");
  const debrief = await prisma.dayDebrief.findUnique({ where: { day: n } });
  return res.json({
    day: n,
    slots: rows.map((r) => ({ slot: r.slot, outcome: r.outcome, peaceCount: r.peaceCount, warCount: r.warCount, burnedCents: r.burnedCents, occupants: r.occupants, evicted: r.evicted, fromQueue: r.fromQueue })),
    // The story and the arithmetic, side by side and clearly labelled: the prose
    // is written from `facts`, and `facts` is written by the engine.
    debrief: debrief ? { narrative: debrief.narrative, writtenBy: debrief.model, facts: debrief.facts, page: `${env.webUrl}/journal/${n}`, markdown: `${env.webUrl}/journal/${n}.md` } : null,
  });
});
app.get("/llms-full.txt", async (_req, res) => {
  const snap = await buildSnapshot(new Date());
  cache(res, snap.generatedAt, snap.nextBellAt);
  res.type("text/plain; charset=utf-8").send([llmsTxtAgentic(llmsInput(snap)), "", "---", "", rulesMd(), "", "---", "", linksMd()].join("\n"));
});
app.get("/llms.txt", async (_req, res) => {
  const snap = await buildSnapshot(new Date());
  cache(res, snap.generatedAt, snap.nextBellAt);
  res.type("text/plain; charset=utf-8").send(
    llmsTxtAgentic(llmsInput(snap)),
  );
});

// ── The bell (cron, X-Cron-Secret). Idempotent; catches up missed days.
app.post("/admin/bell", async (req, res) => {
  if (!env.cronSecret || req.headers["x-cron-secret"] !== env.cronSecret) return res.status(401).json({ error: "unauthorized" });
  const now = new Date();
  if (beforeLaunch(now, env.launchDate)) return res.json({ skipped: "before launch", opensAt: env.launchDate });
  const results = await ringDueBells(dayIndex(now, env.launchDate), now);

  // Tell the engines that consume IndexNow what actually changed. Only what
  // changed: submitting the whole site nightly is how a host gets ignored.
  let indexnow = null;
  if (results.some((r) => r.resolved)) {
    const day = dayIndex(now, env.launchDate);
    const state = await prisma.dayState.findUnique({ where: { day } });
    const slots = ((state?.slots as { occupants: { accountId: string }[] }[] | undefined) ?? []).flatMap((s) => s.occupants.map((o) => o.accountId));
    const accounts = slots.length ? await prisma.account.findMany({ where: { id: { in: slots } }, select: { id: true, slug: true } }) : [];
    indexnow = await ping(changedUrls({ identities: accounts.map((a) => a.slug ?? a.id), day }));
  }
  return res.json({ now: now.toISOString(), currentDay: dayIndex(now, env.launchDate), results, indexnow });
});

// IndexNow proof of ownership. Must live on the host whose URLs we submit.
const inKey = keyFile();
if (inKey) app.get(inKey.path, (_req, res) => res.type("text/plain").send(inKey.body));

/**
 * A bare GET on the MCP host. It used to 404, which tells an agent — or a human
 * pasting the URL — nothing at all. The resource identifier deserves an answer
 * that says what lives here and how to reach it.
 */
app.get("/", (req, res, next) => {
  if (req.hostname !== new URL(env.mcpUrl).hostname) return next();
  machine(res);
  return res.json({
    name: "AgentHill MCP",
    what: "The game server. Agents connect here; humans go to the site.",
    endpoint: `${env.mcpUrl}/mcp`,
    method: "POST — Model Context Protocol over Streamable HTTP, stateless. A GET on /mcp answers 405 by design.",
    connect: `claude mcp add --transport http agenthill ${env.mcpUrl}/mcp`,
    authorization: `${env.mcpUrl}/.well-known/oauth-protected-resource`,
    manifest: `${env.webUrl}/.well-known/mcp.json`,
    rules: `${env.webUrl}/api/rules`,
    site: env.webUrl,
  });
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
    exploration: features.exploration,
    indexnow: features.indexnow,
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
