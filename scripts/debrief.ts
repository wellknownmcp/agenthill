/**
 * The debrief, by hand.
 *
 *   npx tsx scripts/debrief.ts 3            write night 3 if it has none
 *   npx tsx scripts/debrief.ts 3 --force    rewrite it (the prose only; facts are recomputed)
 *   npx tsx scripts/debrief.ts --demo       run the whole chain on invented facts and print it
 *
 * --demo exists because the first real bell only rings once. Shipping a
 * generator whose output nobody has ever read is how you discover at 00:01 UTC
 * that the prompt produces a press release.
 */
import { writeDebrief, buildDebriefFacts, type DebriefFacts } from "../apps/server/src/debrief";
import { debriefMd } from "../apps/server/src/journal";
import { prisma } from "../apps/server/src/db";

/** A plausible night: a burn, an eviction, a newcomer, and a broken promise. */
const DEMO: DebriefFacts = {
  day: 7,
  places: [
    {
      slot: 1,
      outcome: "BURN",
      peaceCount: 1,
      warCount: 2,
      burnedCents: 2600, burned: "$26",
      occupants: [{ name: "Kettleworks", url: "https://kettleworks.example", daysHeld: 0, pointsTonight: 10, rentTomorrow: "$3.45", isNew: true }],
      evicted: [{ name: "Northbeam", url: "https://northbeam.example", nightsHeld: 6 }],
      fromQueue: [{ name: "Kettleworks" }],
    },
    {
      slot: 2,
      outcome: "PEACE",
      peaceCount: 2,
      warCount: 0,
      burnedCents: 0, burned: "$0",
      occupants: [
        { name: "Northbeam", url: "https://northbeam.example", daysHeld: 3, pointsTonight: 4.5, rentTomorrow: "$5.26", isNew: false },
        { name: "Aveline Studio", url: "https://aveline.example", daysHeld: 0, pointsTonight: 4.5, rentTomorrow: "$3.45", isNew: true },
      ],
      evicted: [],
      fromQueue: [],
    },
    { slot: 3, outcome: "VACANT", peaceCount: 0, warCount: 0, burnedCents: 0, burned: "$0", occupants: [], evicted: [], fromQueue: [] },
  ],
  totals: { placesOccupied: 2, placesVacant: 8, movesResolved: 6, peaceMoves: 4, warMoves: 2, burnedCents: 2600, spentCents: 3812, identitiesPlaying: 4, burned: "$26", spent: "$38.12" },
  context: {
    previousNight: { placesOccupied: 3, burned: "$8", movesResolved: 7 },
    burnedAvg7: "$11.40",
    burnedVsAvg7: "above the seven-night average",
    occupancyVsLastNight: "down on last night",
    placesChangedHands: 2,
    longestTenure: { name: "Northbeam", url: "https://northbeam.example", nights: 3 },
    newcomers: [{ name: "Kettleworks", url: "https://kettleworks.example" }, { name: "Aveline Studio", url: "https://aveline.example" }],
    departures: [{ name: "Corvid Labs", url: "https://corvid.example" }],
  },
  word: [
    { name: "Aveline Studio", verdict: "kept", explained: "announced a move and then played exactly that" },
    { name: "Kettleworks", verdict: "betrayed", explained: "announced PEACE and then made WAR" },
    { name: "Corvid Labs", verdict: "ghosted", explained: "announced a move and then played nothing at all" },
  ],
  who: [
    {
      name: "Kettleworks",
      url: "https://kettleworks.example",
      title: "Kettleworks — industrial kettles, built to last",
      description: "A workshop making commercial kettles for small breweries.",
      declaredType: "Organization",
      country: "GB",
      locality: "Sheffield",
      agentSurfaces: ["llms_txt", "robots_allows_ai"],
      pointsTotal30d: 10,
    },
    {
      name: "Northbeam",
      url: "https://northbeam.example",
      title: "Northbeam",
      description: "Analytics for logistics fleets.",
      declaredType: "Corporation",
      country: "SE",
      locality: null,
      agentSurfaces: [],
      pointsTotal30d: 41.5,
    },
    {
      name: "Aveline Studio",
      url: "https://aveline.example",
      title: "Aveline Studio",
      description: null,
      declaredType: null,
      country: "FR",
      locality: "Lyon",
      agentSurfaces: ["llms_txt", "agent_json", "mcp_json"],
      pointsTotal30d: 4.5,
    },
  ],
};

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--demo")) {
    // Reach into the module the same way the bell does, but persist nothing.
    const { writeDemo } = await import("../apps/server/src/debrief");
    const out = await writeDemo(DEMO);
    console.log("--- narrative (%s) ---\n", out.model);
    console.log(out.narrative);
    console.log("\n--- markdown twin ---\n");
    console.log(debriefMd(DEMO.day, DEMO, out.narrative));
    return;
  }

  const day = Number(args[0]);
  if (!Number.isInteger(day)) {
    console.error("usage: debrief.ts <day> [--force] | --demo");
    process.exit(2);
  }
  const facts = await buildDebriefFacts(day);
  console.log(`night ${day}: ${facts.totals.placesOccupied}/10 held, ${facts.totals.movesResolved} moves, ${facts.totals.burnedCents}c burned`);
  const r = await writeDebrief(day, { force: args.includes("--force") });
  console.log(r.written ? `written by ${r.model}` : `not written (${r.reason})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
