/**
 * Several nights of battle, and the journal they produce.
 *
 *   npx tsx scripts/simulate-journal.ts [days] [seed]
 *
 * Runs the engine over N nights with the strategy mix, gives the simulated
 * accounts plausible brands and crawled dossiers, then writes the real debrief
 * for each night — prose and markdown twin — into ./tmp-journal/.
 *
 * Nothing touches the database. The point is to read a WEEK of the journal
 * before the hill has one, and to find out what only a run of nights can show:
 * whether the same brand gets introduced the same way every single night, which
 * is the one thing the feature was asked not to do.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { rentCents, DEFAULT_CONSTANTS as C } from "@agenthill/engine";
import { simulate, DEFAULT_MIX } from "../packages/simulation/src/simulate";
import { writeDemo, type DebriefFacts } from "../apps/server/src/debrief";
import { debriefMd } from "../apps/server/src/journal";

/** Brands for the simulated accounts: a name, a link, and what a crawl found. */
const BRANDS = [
  { name: "Kettleworks", host: "kettleworks.example", title: "Kettleworks", description: "Commercial kettles for small breweries.", declaredType: "Organization", country: "GB", locality: "Sheffield", surfaces: ["llms_txt", "robots_allows_ai"] },
  { name: "Northbeam", host: "northbeam.example", title: "Northbeam", description: "Analytics for logistics fleets.", declaredType: "Corporation", country: "SE", locality: null, surfaces: [] },
  { name: "Aveline Studio", host: "aveline.example", title: "Aveline Studio", description: "A design studio working with independent labels.", declaredType: null, country: "FR", locality: "Lyon", surfaces: ["llms_txt", "agent_json", "mcp_json"] },
  { name: "Corvid Labs", host: "corvid.example", title: "Corvid Labs", description: "Field instruments for ecologists.", declaredType: "ResearchOrganization", country: "NL", locality: "Utrecht", surfaces: ["robots_allows_ai"] },
  { name: "Marchetti & Fils", host: "marchetti.example", title: "Marchetti & Fils — charpente", description: "A carpentry workshop, third generation.", declaredType: "LocalBusiness", country: "FR", locality: "Annecy", surfaces: [] },
  { name: "Halyard", host: "halyard.example", title: "Halyard", description: "Chandlery and rigging.", declaredType: "Store", country: "IE", locality: "Kinsale", surfaces: ["llms_txt"] },
  { name: "Tessera", host: "tessera.example", title: "Tessera", description: "Payments infrastructure for marketplaces.", declaredType: "Corporation", country: "DE", locality: "Berlin", surfaces: ["llms_txt", "mcp_json", "agent_json", "robots_allows_ai"] },
  { name: "Bramble Post", host: "bramblepost.example", title: "Bramble Post", description: "A weekly newsletter about rural logistics.", declaredType: null, country: "GB", locality: null, surfaces: ["llms_txt"] },
  { name: "Okapi Analytics", host: "okapi.example", title: "Okapi", description: "Dashboards nobody asked for, built anyway.", declaredType: "Organization", country: "BE", locality: "Ghent", surfaces: [] },
  { name: "Vellum Rail", host: "vellumrail.example", title: "Vellum Rail", description: "Rolling stock maintenance scheduling.", declaredType: "Corporation", country: "PL", locality: "Kraków", surfaces: ["agent_json"] },
  { name: "Sundries Co", host: "sundries.example", title: "Sundries Co", description: "General supplies, delivered.", declaredType: "Store", country: "US", locality: "Portland", surfaces: ["robots_allows_ai"] },
  { name: "Ferrule", host: "ferrule.example", title: "Ferrule", description: "Precision fittings.", declaredType: "Organization", country: "CH", locality: null, surfaces: ["llms_txt", "mcp_json"] },
];

const usd = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

type Occ = { accountId: string; daysHeld: number };
const occ = (v: unknown): Occ[] => (Array.isArray(v) ? (v as Occ[]) : []);

async function main() {
  const days = Number(process.argv[2] ?? 7);
  const seed = Number(process.argv[3] ?? 42);
  const out = "./tmp-journal";
  mkdirSync(out, { recursive: true });

  // A small field so the same brands recur night after night and tenure can build.
  const mix = { dove: 4, hawk: 3, tit_for_tat: 3, scout: 2, opportunist: 0 } as typeof DEFAULT_MIX;
  const sim = simulate({ days, seed, budgetCents: 4000, mix, refuel: { belowCents: 600, cents: 2000, max: 3 } });

  // Give every simulated account a brand, stably.
  const ids = [...new Set(sim.agents.map((a) => a.accountId))];
  const brandOf = new Map(ids.map((id, i) => [id, BRANDS[i % BRANDS.length]!]));
  const label = (id: string) => ({ name: brandOf.get(id)!.name, url: `https://${brandOf.get(id)!.host}` });

  const pointsByDay = new Map<string, number>();
  for (const p of sim.points) pointsByDay.set(`${p.day}:${p.slot}:${p.accountId}`, p.points);

  console.log(`${days} nights, ${ids.length} identities, seed ${seed}\n`);
  const introductions: Record<string, string[]> = {};

  for (const nightIdx of sim.history.keys()) {
    const night = sim.history[nightIdx]!;
    const prev = nightIdx > 0 ? sim.history[nightIdx - 1]! : null;
    const day = night.day;

    const nowIds = new Set(night.slots.flatMap((s) => occ(s.occupants).map((o) => o.accountId)));
    const prevIds = new Set((prev?.slots ?? []).flatMap((s) => occ(s.occupants).map((o) => o.accountId)));
    const dayLedger = sim.ledger.filter((l) => l.day === day);
    const prevLedger = sim.ledger.filter((l) => l.day === day - 1);
    const burned = night.slots.reduce((s, r) => s + r.burnedCents, 0);
    const spent = dayLedger.reduce((s, l) => s + l.cents, 0);
    const prevBurned = (prev?.slots ?? []).reduce((s, r) => s + r.burnedCents, 0);
    const prevOccupied = (prev?.slots ?? []).filter((s) => occ(s.occupants).length > 0).length;
    const occupied = night.slots.filter((s) => occ(s.occupants).length > 0).length;

    const last7 = sim.history.slice(Math.max(0, nightIdx - 7), nightIdx);
    const avg7 = last7.length ? Math.round(last7.reduce((s, h) => s + h.slots.reduce((x, r) => x + r.burnedCents, 0), 0) / last7.length) : null;

    const points30 = new Map<string, number>();
    for (const p of sim.points) if (p.day <= day && p.day > day - 30) points30.set(p.accountId, (points30.get(p.accountId) ?? 0) + p.points);

    const places: DebriefFacts["places"] = night.slots.map((r) => {
      const prevHere = new Set(occ((prev?.slots ?? []).find((p) => p.slot === r.slot)?.occupants).map((o) => o.accountId));
      return {
        slot: r.slot,
        outcome: r.outcome,
        peaceCount: r.peaceCount,
        warCount: r.warCount,
        burnedCents: r.burnedCents,
        burned: usd(r.burnedCents),
        occupants: occ(r.occupants).map((o) => ({
          ...label(o.accountId),
          daysHeld: o.daysHeld ?? 0,
          pointsTonight: pointsByDay.get(`${day}:${r.slot}:${o.accountId}`) ?? 0,
          rentTomorrow: usd(rentCents((o.daysHeld ?? 0) + 1, C)),
          isNew: !prevHere.has(o.accountId),
        })),
        evicted: occ(r.evicted).map((e) => ({ ...label(e.accountId), nightsHeld: e.daysHeld ?? 0 })),
        fromQueue: occ(r.fromQueue).map((q) => ({ name: label(q.accountId).name })),
      };
    });

    const facts: DebriefFacts = {
      day,
      places,
      totals: {
        placesOccupied: occupied,
        placesVacant: 10 - occupied,
        movesResolved: dayLedger.length,
        peaceMoves: dayLedger.filter((l) => l.kind === "RENT").length,
        warMoves: dayLedger.filter((l) => l.kind !== "RENT").length,
        burnedCents: burned,
        spentCents: spent,
        identitiesPlaying: new Set(dayLedger.map((l) => l.accountId)).size,
        burned: usd(burned),
        spent: usd(spent),
      },
      context: {
        previousNight: prev ? { placesOccupied: prevOccupied, burned: usd(prevBurned), movesResolved: prevLedger.length } : null,
        burnedAvg7: avg7 === null ? null : usd(avg7),
        burnedVsAvg7: avg7 === null ? null : burned > avg7 * 1.15 ? "above the seven-night average" : burned < avg7 * 0.85 ? "below the seven-night average" : "about the seven-night average",
        occupancyVsLastNight: prev ? (occupied > prevOccupied ? "up on last night" : occupied < prevOccupied ? "down on last night" : "unchanged from last night") : null,
        placesChangedHands: night.slots.filter((r) => {
          const before = occ((prev?.slots ?? []).find((p) => p.slot === r.slot)?.occupants).map((o) => o.accountId).sort().join(",");
          return before !== occ(r.occupants).map((o) => o.accountId).sort().join(",");
        }).length,
        longestTenure: (() => {
          const t = places.flatMap((p) => p.occupants).sort((a, b) => b.daysHeld - a.daysHeld)[0];
          return t ? { name: t.name, url: t.url, nights: t.daysHeld } : null;
        })(),
        newcomers: [...nowIds].filter((i) => !prevIds.has(i)).map(label),
        departures: [...prevIds].filter((i) => !nowIds.has(i)).map(label),
      },
      // The simulator has no announcements; the verdicts are exercised by the unit tests.
      word: [],
      who: [...nowIds].map((id) => {
        const b = brandOf.get(id)!;
        return {
          name: b.name,
          url: `https://${b.host}`,
          title: b.title,
          description: b.description,
          declaredType: b.declaredType,
          country: b.country,
          locality: b.locality,
          agentSurfaces: b.surfaces,
          pointsTotal30d: Math.round((points30.get(id) ?? 0) * 100) / 100,
        };
      }),
    };

    const { narrative, model } = await writeDemo(facts);
    writeFileSync(`${out}/night-${day}.md`, debriefMd(day, facts, narrative));

    // What did it say about each brand tonight? The variety question, answered
    // by reading rather than hoping.
    for (const p of facts.who) {
      const sentence = narrative.split(/(?<=\.)\s+/).find((s) => s.includes(p.name));
      if (sentence) (introductions[p.name] ??= []).push(sentence.trim());
    }

    console.log(`night ${day}: ${occupied}/10 held, ${dayLedger.length} moves, ${usd(burned)} burned — ${model}`);
  }

  console.log(`\n--- how the same brand was introduced, night after night ---`);
  for (const [name, lines] of Object.entries(introductions)) {
    if (lines.length < 2) continue;
    const unique = new Set(lines.map((l) => l.toLowerCase().replace(/[^a-z ]/g, "")));
    console.log(`\n${name}: ${lines.length} mentions, ${unique.size} distinct`);
    for (const l of lines.slice(0, 4)) console.log(`   · ${l.slice(0, 150)}`);
  }
  console.log(`\nwritten to ${out}/night-*.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
