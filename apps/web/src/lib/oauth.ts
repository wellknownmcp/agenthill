/**
 * The page is itself an OAuth client of the Animam AS: authorization code +
 * PKCE, registered once through DCR and kept in the database. The token it
 * obtains is only used to learn `sub` — the human's account id. Nothing else is
 * stored from it.
 *
 * PUBLIC client, not confidential: this authorization server only issues
 * `token_endpoint_auth_method: "none"`. Asking for a client secret is refused
 * with 400, and retrying that on every visit is what got us rate-limited. PKCE
 * is what protects the exchange, and the redirect URI is registered — which is
 * the standard posture for this flow anyway.
 */
import { createHash, randomBytes } from "node:crypto";
import { decodeJwt } from "jose";
import { prisma } from "./db";

const ISSUER = process.env.OAUTH_ISSUER ?? "https://api.animam.ai";
const RESOURCE = process.env.OAUTH_AUDIENCE ?? "https://mcp.agenthill.lol";
const WEB = process.env.PUBLIC_WEB_URL ?? "https://agenthill.lol";
export const REDIRECT_URI = `${WEB}/auth/callback`;

export class SignInUnavailable extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

/** Registering is done once, ever. Memoised in process so a burst of requests
 *  cannot turn into a burst of registrations against the authorization server. */
let memo: Promise<{ clientId: string }> | null = null;

export async function clientCredentials(): Promise<{ clientId: string }> {
  if (!memo) {
    memo = register().catch((e) => {
      memo = null; // a failure must not be cached for ever
      throw e;
    });
  }
  return memo;
}

async function register(): Promise<{ clientId: string }> {
  const envId = process.env.OAUTH_CLIENT_ID;
  if (envId) return { clientId: envId };
  const row = await prisma.oauthClientRegistration.findUnique({ where: { id: "web" } });
  if (row) return { clientId: row.clientId };
  // Dynamic Client Registration (RFC 7591), once.
  const r = await fetch(`${ISSUER}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "AgentHill (web)",
      client_uri: WEB,
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "hill:read hill:play",
    }),
  });
  if (!r.ok) throw new SignInUnavailable(`the authorization server refused to register this app (${r.status})`);
  const j = (await r.json()) as { client_id: string };
  if (!j.client_id) throw new SignInUnavailable("the authorization server returned no client id");
  // upsert, not create: two requests racing must not lose the registration.
  await prisma.oauthClientRegistration.upsert({
    where: { id: "web" },
    create: { id: "web", clientId: j.client_id, clientSecret: "" },
    update: { clientId: j.client_id },
  });
  return { clientId: j.client_id };
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function authorizeUrl(state: string, challenge: string): Promise<string> {
  const { clientId } = await clientCredentials();
  const u = new URL(`${ISSUER}/oauth/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("scope", "hill:read hill:play");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("resource", RESOURCE);
  return u.toString();
}

export async function exchangeCode(code: string, verifier: string): Promise<{ accountId: string; slug?: string; email?: string }> {
  const { clientId } = await clientCredentials();
  // No client_secret: this is a public client, PKCE is the proof.
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier, resource: RESOURCE });
  const r = await fetch(`${ISSUER}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error(`token exchange failed: ${r.status}`);
  const j = (await r.json()) as { access_token: string };
  const claims = decodeJwt(j.access_token); // signature was just verified by the issuer round-trip; we only read sub
  if (typeof claims.sub !== "string") throw new Error("no sub");
  const out: { accountId: string; slug?: string; email?: string } = { accountId: claims.sub };
  if (typeof claims["tenant"] === "string") out.slug = claims["tenant"] as string;
  if (typeof claims["email"] === "string") out.email = claims["email"] as string;
  return out;
}
