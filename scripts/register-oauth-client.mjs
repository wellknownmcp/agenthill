#!/usr/bin/env node
/**
 * Register the web app as an OAuth client, once, deliberately.
 *
 * This used to happen lazily on the first visit to /auth/login — which meant a
 * crawler could trigger it, and a burst of visits became a burst of
 * registrations until the authorization server rate-limited us. Registration is
 * a provisioning act: it belongs in a script you run, not in a request path.
 *
 *   node scripts/register-oauth-client.mjs           # register if absent
 *   node scripts/register-oauth-client.mjs --force   # register again anyway
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(resolve(root, ".env"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}

const ISSUER = process.env.OAUTH_ISSUER ?? "https://api.animam.ai";
const WEB = process.env.PUBLIC_WEB_URL ?? "https://agenthill.lol";
const prisma = new PrismaClient();

const existing = await prisma.oauthClientRegistration.findUnique({ where: { id: "web" } });
if (existing && !process.argv.includes("--force")) {
  console.log(`Already registered: ${existing.clientId} (${existing.createdAt.toISOString().slice(0, 10)})`);
  console.log("Nothing to do. Pass --force to register a new client anyway.");
  process.exit(0);
}

const body = {
  client_name: "AgentHill (web)",
  client_uri: WEB,
  redirect_uris: [`${WEB}/auth/callback`],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none", // this AS only issues public clients; PKCE protects the exchange
  scope: "hill:read hill:play",
};

const r = await fetch(`${ISSUER}/oauth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const text = await r.text();
if (!r.ok) {
  console.error(`Registration refused: ${r.status}\n${text.slice(0, 300)}`);
  if (r.status === 429) console.error("\nThe authorization server is rate-limiting registrations. Wait it out, or run this from another address.");
  process.exit(1);
}
const j = JSON.parse(text);
if (!j.client_id) {
  console.error("The authorization server returned no client_id.");
  process.exit(1);
}
await prisma.oauthClientRegistration.upsert({
  where: { id: "web" },
  create: { id: "web", clientId: j.client_id, clientSecret: "" },
  update: { clientId: j.client_id },
});
console.log(`Registered ${j.client_id} against ${ISSUER} and stored it.`);
console.log("Restart the web process so it picks the record up.");
await prisma.$disconnect();
