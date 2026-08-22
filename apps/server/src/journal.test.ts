/**
 * The journal's promise is a link under every name. These pages are the reason
 * somebody paid, so a name printed without its href is not a formatting slip —
 * it is the product not being delivered that night.
 */
import { describe, expect, it } from "vitest";
import { debriefMd } from "./journal";
import { stripStructure, type DebriefFacts } from "./debrief";

const facts: DebriefFacts = {
  day: 4,
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
    { slot: 2, outcome: "VACANT", peaceCount: 0, warCount: 0, burnedCents: 0, burned: "$0", occupants: [], evicted: [], fromQueue: [] },
    {
      slot: 3,
      outcome: "PEACE",
      peaceCount: 1,
      warCount: 0,
      burnedCents: 0,
      burned: "$0",
      // An identity that never declared a site: it has no link to give.
      occupants: [{ name: "Quiet Co", url: null, daysHeld: 2, pointsTonight: 8, rentTomorrow: "$4.57", isNew: false }],
      evicted: [],
      fromQueue: [],
    },
  ],
  totals: { placesOccupied: 2, placesVacant: 8, movesResolved: 6, peaceMoves: 4, warMoves: 2, burnedCents: 2600, spentCents: 3812, identitiesPlaying: 4, burned: "$26", spent: "$38.12" },
  context: {
    previousNight: { placesOccupied: 3, burned: "$8", movesResolved: 7 },
    burnedAvg7: "$11.40",
    burnedVsAvg7: "above the seven-night average",
    occupancyVsLastNight: "down on last night",
    placesChangedHands: 2,
    longestTenure: { name: "Quiet Co", url: null, nights: 2 },
    newcomers: [{ name: "Kettleworks", url: "https://kettleworks.example" }],
    departures: [{ name: "Corvid Labs", url: "https://corvid.example" }],
  },
  word: [
    { name: "Quiet Co", verdict: "kept", explained: "announced a move and then played exactly that" },
    { name: "Kettleworks", verdict: "betrayed", explained: "announced PEACE and then made WAR" },
  ],
  who: [
    { name: "Kettleworks", url: "https://kettleworks.example", title: "t", description: "d", declaredType: "Organization", country: "GB", locality: "Sheffield", agentSurfaces: ["llms_txt"], pointsTotal30d: 10 },
    { name: "Quiet Co", url: null, title: null, description: null, declaredType: null, country: null, locality: null, agentSurfaces: [], pointsTotal30d: 24 },
  ],
};

const md = debriefMd(4, facts, "Night four went badly for the incumbent.");

describe("the nightly debrief, rendered", () => {
  it("gives every identity that declared a site its link, everywhere it is named", () => {
    // Occupant, evicted, newcomer, departure, and the roll call at the bottom.
    const linked = md.match(/\[Kettleworks\]\(https:\/\/kettleworks\.example\)/g) ?? [];
    expect(linked.length, "Kettleworks is named several times and linked each time").toBeGreaterThanOrEqual(3);
    expect(md).toContain("[Northbeam](https://northbeam.example)");
    expect(md).toContain("[Corvid Labs](https://corvid.example)");
  });

  it("names an identity with no site without inventing a link for it", () => {
    expect(md).toContain("Quiet Co");
    expect(md).not.toMatch(/\[Quiet Co\]\(/);
  });

  it("carries the narrative and never lets it stand alone", () => {
    expect(md).toContain("Night four went badly for the incumbent.");
    expect(md).toContain("The night in figures");
    expect(md).toContain("$26"); // burned; whole dollars print without cents
    expect(md).toContain("$38.12"); // consumed
  });

  it("situates the night against the ones before it", () => {
    expect(md).toContain("Last night");
    expect(md).toContain("last 7");
    expect(md).toContain("changed hands");
  });

  it("states the link policy and points at the raw figures", () => {
    expect(md).toContain("dofollow");
    expect(md).toContain("/api/day/4");
  });

  it("renders a vacant place rather than skipping it", () => {
    expect(md).toContain("| 2 | vacant |");
  });

  it("says that an announcement orders nothing", () => {
    expect(md).toContain("orders nothing");
  });
});

describe("the narrative never brings its own structure", () => {
  it("drops headings the writer emits despite being asked not to", () => {
    const out = stripStructure("# AgentHill — Night 7\n\nThe bell found two places held.\n\n## Later\n\nAnd then.");
    expect(out).toBe("The bell found two places held.\n\nAnd then.");
  });

  it("leaves a paragraph that merely contains a hash alone", () => {
    expect(stripStructure("Place #1 burned.")).toBe("Place #1 burned.");
  });
});
