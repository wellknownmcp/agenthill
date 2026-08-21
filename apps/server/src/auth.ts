/**
 * AgentHill is a protected resource of the Animam authorization server
 * (RFC 8707 / RFC 9728). Tokens are RS256 JWTs verified against the AS JWKS,
 * with a STRICT audience check: a token minted for mcp.animam.ai is refused.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Request, Response } from "express";
import { env } from "./env";
import { prisma } from "./db";

export interface Auth {
  accountId: string; // AS `sub` = Animam tenant id
  agentId: string; // OAuth client_id
  slug?: string;
  email?: string;
  scopes: string[];
}

const jwks = createRemoteJWKSet(new URL(env.oauthJwksUrl));

export async function authenticate(req: Request): Promise<Auth | null> {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  const token = h.slice(7).trim();
  if (token.split(".").length !== 3) return null;
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwks, { issuer: env.oauthIssuer, audience: env.oauthAudience, algorithms: ["RS256"], clockTolerance: 30 }));
  } catch {
    return null;
  }
  const sub = typeof payload.sub === "string" ? payload.sub : null;
  const clientId = typeof payload["client_id"] === "string" ? (payload["client_id"] as string) : null;
  if (!sub || !clientId) return null;
  const scopes = typeof payload["scope"] === "string" ? (payload["scope"] as string).split(" ").filter(Boolean) : [];
  const auth: Auth = { accountId: sub, agentId: clientId, scopes };
  if (typeof payload["tenant"] === "string") auth.slug = payload["tenant"] as string;
  if (typeof payload["email"] === "string") auth.email = payload["email"] as string;
  return auth;
}

/** Ensure the account and the agent exist. Lazy creation: the first call IS the signup. */
export async function ensureIdentity(auth: Auth): Promise<void> {
  await prisma.account.upsert({
    where: { id: auth.accountId },
    create: { id: auth.accountId, slug: auth.slug ?? null, email: auth.email ?? null },
    update: { ...(auth.slug ? { slug: auth.slug } : {}), ...(auth.email ? { email: auth.email } : {}) },
  });
  await prisma.agent.upsert({
    where: { id: auth.agentId },
    create: { id: auth.agentId, accountId: auth.accountId },
    update: { lastSeenAt: new Date() },
  });
}

export function hasScope(auth: Auth, scope: string): boolean {
  return auth.scopes.includes(scope);
}

export function resourceMetadata() {
  return {
    resource: env.oauthAudience,
    authorization_servers: [env.oauthIssuer],
    scopes_supported: ["hill:read", "hill:play"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${env.webUrl}/rules`,
  };
}

export function unauthorized(res: Response, error: "missing_token" | "invalid_token" = "invalid_token") {
  const meta = `${env.mcpUrl}/.well-known/oauth-protected-resource`;
  const desc = error === "missing_token" ? "Authorization required" : "Invalid or expired token";
  res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${meta}", error="${error}", error_description="${desc}"`);
  return res.status(401).json({ error, error_description: desc, resource_metadata: meta });
}
