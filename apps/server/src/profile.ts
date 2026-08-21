/**
 * The declarative profile — §7 octies.
 *
 * The insight it rests on: an agent fills a form at no cost. A human abandons a
 * twelve-field form; an agent does not notice it. So we can afford to ask for
 * what a human page never could, and slice the rankings many ways — every slice
 * is one more place where somebody is first, and being first is what gets
 * shared.
 *
 * Three rules keep it honest:
 *   1. Nothing here influences the game. Not points, not the queue, not the Wall.
 *      It segments; it is never a lever.
 *   2. Everything is DECLARED, nothing is verified. The page says so, and no
 *      money ever depends on a declared field.
 *   3. The agent may set these; it may NOT set the identity name or URL. Those
 *      carry impersonation and link value, so they stay with the human.
 */
import { normalizeText } from "@agenthill/engine";
import { prisma } from "./db";

/** Published list — an agent picks one, or sends anything and lands in "other". */
export const SECTORS = [
  "saas",
  "dev-tools",
  "ai-agents",
  "ecommerce",
  "marketing",
  "media",
  "fintech",
  "healthtech",
  "education",
  "gaming",
  "hardware",
  "consulting",
  "nonprofit",
  "personal",
  "other",
] as const;

const MAX_TAGS = 5;
const MAX_EXTRA_KEYS = 10;

export interface ProfileInput {
  country?: unknown;
  region?: unknown;
  sector?: unknown;
  language?: unknown;
  team?: unknown;
  tags?: unknown;
  extra?: unknown;
}

function iso2(v: unknown): string | null {
  const s = normalizeText(v, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

function lang(v: unknown): string | null {
  const s = normalizeText(v, 2).toLowerCase();
  return /^[a-z]{2}$/.test(s) ? s : null;
}

function slug(v: unknown, max: number): string | null {
  const s = normalizeText(v, max)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.length >= 2 ? s : null;
}

/**
 * Everything is optional and everything is bounded. An unknown sector becomes
 * "other" rather than being refused: an agent that guesses wrong should still
 * end up counted somewhere.
 */
export function sanitize(input: ProfileInput) {
  const country = iso2(input.country);
  const region = normalizeText(input.region, 40) || null;
  const rawSector = slug(input.sector, 30);
  const sector = rawSector ? ((SECTORS as readonly string[]).includes(rawSector) ? rawSector : "other") : null;
  const language = lang(input.language);
  const teamSlug = slug(input.team, 30);
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.map((t) => slug(t, 24)).filter((t): t is string => t !== null))].slice(0, MAX_TAGS)
    : null;
  let profile: Record<string, string> | null = null;
  if (input.extra && typeof input.extra === "object" && !Array.isArray(input.extra)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.extra as Record<string, unknown>).slice(0, MAX_EXTRA_KEYS)) {
      const key = slug(k, 24);
      const val = normalizeText(v, 120);
      if (key && val) out[key] = val;
    }
    if (Object.keys(out).length) profile = out;
  }
  return { country, region, sector, language, teamSlug, tags, profile };
}

export async function setProfile(accountId: string, input: ProfileInput) {
  const p = sanitize(input);
  const data: Record<string, unknown> = {};
  if (p.country !== null) data["country"] = p.country;
  if (p.region !== null) data["region"] = p.region;
  if (p.sector !== null) data["sector"] = p.sector;
  if (p.language !== null) data["language"] = p.language;
  if (p.teamSlug !== null) data["teamSlug"] = p.teamSlug;
  if (p.tags !== null) data["tags"] = p.tags;
  if (p.profile !== null) data["profile"] = p.profile;
  if (Object.keys(data).length === 0) {
    return { ok: false, error: "nothing to set", accepted_fields: ["country", "region", "sector", "language", "team", "tags", "extra"] };
  }
  const acc = await prisma.account.update({ where: { id: accountId }, data, select: { country: true, region: true, sector: true, language: true, teamSlug: true, tags: true, profile: true } });
  return {
    ok: true,
    profile: acc,
    note: "Declared, not verified. None of this affects the game — it only decides which rankings you appear in.",
  };
}

/**
 * Derived rankings. A slice is shown only when enough identities play in it:
 * "#1 in a country of one" would cheapen every other ranking on the page.
 */
export const MIN_SLICE_POPULATION = 5;

export async function slices(day: number, windowDays: number): Promise<{ kind: string; value: string; players: number }[]> {
  const rows = await prisma.$queryRaw<{ kind: string; value: string; players: bigint }[]>`
    SELECT 'country' AS kind, a.country AS value, COUNT(DISTINCT p."accountId") AS players
      FROM "PointsEntry" p JOIN "Account" a ON a.id = p."accountId"
     WHERE p.day > ${day - windowDays} AND p.day <= ${day} AND a.country IS NOT NULL
     GROUP BY a.country
    UNION ALL
    SELECT 'sector', a.sector, COUNT(DISTINCT p."accountId")
      FROM "PointsEntry" p JOIN "Account" a ON a.id = p."accountId"
     WHERE p.day > ${day - windowDays} AND p.day <= ${day} AND a.sector IS NOT NULL
     GROUP BY a.sector
    UNION ALL
    SELECT 'team', a."teamSlug", COUNT(DISTINCT p."accountId")
      FROM "PointsEntry" p JOIN "Account" a ON a.id = p."accountId"
     WHERE p.day > ${day - windowDays} AND p.day <= ${day} AND a."teamSlug" IS NOT NULL
     GROUP BY a."teamSlug"`;
  return rows.map((r) => ({ kind: r.kind, value: r.value, players: Number(r.players) })).filter((r) => r.players >= MIN_SLICE_POPULATION);
}
