/**
 * 👀 views: the page tells the server which identities a human saw today.
 * Visitor = salted hash of IP + UA, one row per identity per day. No cookie.
 */
import { createHash } from "node:crypto";
import { headers } from "next/headers";

const SERVER = process.env.SERVER_INTERNAL_URL ?? "http://127.0.0.1:3303";
const AI_UA = /GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|AnthropicBot|PerplexityBot|Perplexity-User|Google-Extended|GoogleOther|Applebot-Extended|Bytespider|CCBot|DuckAssistBot|MistralAI-User|Meta-ExternalAgent|bot|crawler|spider/i;

export function recordViews(accountIds: string[]): void {
  if (!accountIds.length) return;
  const h = headers();
  const ua = h.get("user-agent") ?? "";
  const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const isAgent = AI_UA.test(ua);
  const day = new Date().toISOString().slice(0, 10);
  const visitor = createHash("sha256").update(`${day}|${process.env.CRON_SECRET ?? ""}|${ip}|${ua}`).digest("hex").slice(0, 32);
  // fire-and-forget, but never silent: a failure is logged
  fetch(`${SERVER}/internal/seen`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-secret": process.env.CRON_SECRET ?? "" },
    body: JSON.stringify({ kind: isAgent ? "agent" : "view", accountIds: [...new Set(accountIds)], visitor }),
  }).catch((e) => console.error("[metrics] seen failed", e instanceof Error ? e.message : e));
}
