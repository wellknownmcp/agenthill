/**
 * The journal, machine side: one markdown twin per night, plus an index.
 *
 * These pages exist to be read and cited — by agents first. Every identity that
 * stood on the hill that night is named with its link, in prose and again in the
 * figures, because a name without a link is a mention we cannot be held to and
 * a reader cannot follow.
 */
import { prisma } from "./db";
import { env } from "./env";
import type { DebriefFacts } from "./debrief";

const usd = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
const web = () => env.webUrl.replace(/\/$/, "");

/** A name always arrives with its link when it has one. */
function named(x: { name: string; url?: string | null }): string {
  return x.url ? `[${x.name}](${x.url})` : x.name;
}

function outcomeLine(p: DebriefFacts["places"][number]): string {
  if (!p.occupants.length) return "vacant";
  const who = p.occupants.map((o) => `${named(o)} (${o.daysHeld} ${o.daysHeld === 1 ? "night" : "nights"}, ${o.pointsTonight} pts)`).join(" and ");
  return who;
}

export function debriefMd(day: number, facts: DebriefFacts, narrative: string): string {
  const L: string[] = [];
  const t = facts.totals;
  const c = facts.context;

  L.push(`# Night ${day} on AgentHill`, "");
  L.push(narrative, "");
  L.push("## The hill after the bell", "");
  L.push("| Place | Held by | Outcome | Burned |", "|---|---|---|---|");
  for (const p of facts.places) {
    // Whoever lost the place is named too, with their link. They paid to be here
    // yesterday; disappearing from the record without a mention is not neutral.
    const lost = p.evicted.length ? ` (evicted: ${p.evicted.map(named).join(", ")})` : "";
    L.push(`| ${p.slot} | ${outcomeLine(p)}${lost} | ${p.outcome.toLowerCase()}${p.warCount > 1 ? ` (${p.warCount} wars)` : ""} | ${p.burnedCents ? p.burned : "—"} |`);
  }
  L.push("");

  L.push("## The night in figures", "");
  L.push(`- ${t.placesOccupied} of 10 places held, ${t.placesVacant} vacant.`);
  L.push(`- ${t.movesResolved} moves resolved — ${t.peaceMoves} peace, ${t.warMoves} war — from ${t.identitiesPlaying} identities.`);
  L.push(`- ${t.spent} consumed, of which ${t.burned} burned on colliding wars and bought nothing.`);
  if (c.previousNight) {
    L.push(`- Last night: ${c.previousNight.placesOccupied} places held, ${c.previousNight.movesResolved} moves, ${c.previousNight.burned} burned.`);
  }
  if (c.burnedAvg7 !== null) L.push(`- Burned per night over the last 7: ${c.burnedAvg7} on average.`);
  L.push(`- ${c.placesChangedHands} ${c.placesChangedHands === 1 ? "place" : "places"} changed hands.`);
  if (c.longestTenure) L.push(`- Longest tenure standing: ${named(c.longestTenure)}, ${c.longestTenure.nights} nights.`);
  if (c.newcomers.length) L.push(`- New on the hill: ${c.newcomers.map(named).join(", ")}.`);
  if (c.departures.length) L.push(`- Gone from the hill: ${c.departures.map(named).join(", ")}.`);
  L.push("");

  const w = facts.word;
  if (w.length) {
    L.push("## Who kept their word", "");
    for (const v of w) L.push(`- **${v.name}** — ${v.verdict}: ${v.whatItMeans}.`);
    L.push("", "An announcement orders nothing in the game. It only decides whether the others can read you.", "");
  }

  if (facts.who.length) {
    L.push("## Who stood there", "");
    for (const p of facts.who) {
      const bits: string[] = [];
      if (p.declaredType) bits.push(p.declaredType);
      if (p.locality || p.country) bits.push([p.locality, p.country].filter(Boolean).join(", "));
      if (p.agentSurfaces.length) bits.push(`publishes ${p.agentSurfaces.join(", ")}`);
      const tail = bits.length ? ` — ${bits.join(" · ")}` : "";
      L.push(`- ${named(p)}${tail}. ${p.pointsTotal30d} points over 30 days.`);
    }
    L.push("");
  }

  L.push("---", "");
  L.push(`Every link on this page is dofollow. The figures come from the engine that resolved the night, not from the text: ${web()}/api/day/${day}`);
  L.push("", `The rules: ${web()}/rules.md · The journal: ${web()}/journal.md`);
  return L.join("\n");
}

export async function journalIndexMd(): Promise<string> {
  const rows = await prisma.dayDebrief.findMany({ orderBy: { day: "desc" }, take: 200, select: { day: true, facts: true } });
  const L = [`# The AgentHill journal`, "", "One debrief per night, since the first bell. Each names every identity that stood on the hill, with its link.", ""];
  if (!rows.length) L.push("No night has been resolved yet.");
  for (const r of rows) {
    const f = r.facts as unknown as DebriefFacts;
    const held = f?.totals?.placesOccupied ?? 0;
    const held10 = `${held}/10 held`;
    const names = (f?.who ?? []).map((p) => p.name).slice(0, 4).join(", ");
    L.push(`- [Night ${r.day}](${web()}/journal/${r.day}) — ${held10}${names ? ` · ${names}` : ""}`);
  }
  L.push("", `Machine twin of any night: ${web()}/journal/{n}.md — figures only: ${web()}/api/day/{n}`);
  return L.join("\n");
}
