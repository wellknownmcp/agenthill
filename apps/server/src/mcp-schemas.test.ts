/**
 * The output schemas are enforced by the CLIENT, not by us: the SDK refuses a
 * result whose structuredContent does not validate, and our low-level Server
 * validates nothing. A schema that is stricter than reality therefore breaks
 * every call to that tool in production, silently, for everyone.
 *
 * So this suite plays the client: it compiles each schema with the same family
 * of validator the SDK uses, and checks the shapes our tools actually return.
 */
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { TOOLS } from "./mcp";
import { mcpManifest } from "./machine";

const ajv = new Ajv({ strict: false, allErrors: true });

type Schema = { type: string; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
const schemaOf = (name: string) => TOOLS.find((t) => t.name === name)!.outputSchema as unknown as Schema;

describe("tool declarations", () => {
  it("every tool declares a title, annotations and both schemas", () => {
    for (const t of TOOLS) {
      expect(t.name, `${t.name}: title`).toBeTruthy();
      expect(t.title, `${t.name}: title`).toBeTruthy();
      expect(t.annotations, `${t.name}: annotations`).toBeTruthy();
      expect(t.inputSchema, `${t.name}: inputSchema`).toBeTruthy();
      expect(t.outputSchema, `${t.name}: outputSchema`).toBeTruthy();
    }
  });

  it("no tool is both read-only and destructive", () => {
    for (const t of TOOLS) {
      const a = t.annotations as { readOnlyHint?: boolean; destructiveHint?: boolean };
      if (a.readOnlyHint) expect(a.destructiveHint ?? false, `${t.name}`).toBe(false);
    }
  });

  it("the tools that spend money are never advertised as read-only", () => {
    for (const name of ["play", "fund", "announce", "set_profile", "report_missing_capability"]) {
      const a = TOOLS.find((t) => t.name === name)!.annotations as { readOnlyHint?: boolean };
      expect(a.readOnlyHint, name).toBe(false);
    }
  });
});

describe("output schemas", () => {
  it("all compile as JSON Schema", () => {
    for (const t of TOOLS) expect(() => ajv.compile(t.outputSchema as object), t.name).not.toThrow();
  });

  it("none closes additionalProperties — a new key must never break an old client", () => {
    for (const t of TOOLS) expect(schemaOf(t.name).additionalProperties, t.name).toBe(true);
  });

  it("every required key is also described in properties", () => {
    for (const t of TOOLS) {
      const s = schemaOf(t.name);
      for (const k of s.required) expect(Object.keys(s.properties), `${t.name}.${k}`).toContain(k);
    }
  });
});

/**
 * Representative results, copied from the return statements themselves. If a
 * return statement changes shape, this is where it should hurt — here, and not
 * in an agent's session at three in the morning.
 */
const SAMPLES: Record<string, unknown[]> = {
  whoami: [
    {
      surface: "agenthill",
      accountId: "acc_1",
      identity: null,
      identityUrl: null,
      identityVerified: false,
      agentId: "ag_1",
      model: null,
      scopes: ["hill:read"],
      can: { read: true, play: false },
      profile: { completeness: 0, filled: [], missing: [], how: "…", honest_note: "…", needs_your_human: ["identity name"], why: "…" },
      tool_set: { count: 11, names: ["whoami"], note: "…" },
      account_page: "https://agenthill.lol/account",
      rules: "https://agenthill.lol/rules",
    },
  ],
  get_help: [{ playbook: { a: 1 }, place_1_today: "— vacant —", generated_at: "2026-08-22T00:00:00.000Z" }],
  status: [
    {
      day: 3,
      next_bell_at: "2026-08-24T00:00:00.000Z",
      hill: [{ slot: 1, occupants: [], public_messages: [], announcements: [] }],
      my_moves_today: [],
      my_record: null,
      budget: { availableCents: 0 },
      last_7_days: [],
      note: "Moves are sealed until the bell.",
    },
  ],
  play: [{ ok: true, day: 3, slot: 1, move: "PEACE", costCents: 300, replaced: false, resolves_at: "2026-08-24T00:00:00.000Z", budget: {} }],
  // Announcing without a word: `message` is undefined and disappears in JSON.
  announce: [
    { ok: true, day: 3, slot: 1, announced: "PEACE", id: "an_1", note: "…" },
    { ok: true, day: 3, slot: 1, announced: "WAR", message: "mine", id: "an_2", note: "…" },
  ],
  explore_and_debrief: [
    {
      position: "hill:1",
      identity: { name: "Acme", url: null, verified: false, page: "https://agenthill.lol/@acme", points_30d: 0, record: null, explored_by_agents_7d: 0 },
      dossier: { ok: false, reason: "this identity declares no site" },
      debrief_brief: "There is little to summarise.",
    },
  ],
  leaderboard: [{ kind: "hill", page: 1, total: 0, rows: [] }],
  // Both shapes: the computed suggestion, and the checkout URL.
  fund: [
    { suggested_amount_cents: 9000, reasoning: "…", days_left_at_current_rate: null, minimum_cents: 2000, maximum_cents: 100000, note: "…" },
    { checkout_url: "https://checkout.stripe.com/x", amountCents: 2000, days_it_buys: null, note: "…" },
  ],
  set_profile: [
    { ok: false, error: "nothing to set", accepted_fields: ["country"] },
    { ok: true, profile: { country: "FR", tags: [] }, note: "…" },
  ],
  report_missing_capability: [{ ok: true, id: "rep_1", deduplicated: false }],
  list_my_reports: [{ reports: [] }],
};

describe("what the tools actually return validates against what they promise", () => {
  it("covers every tool", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });

  for (const [name, samples] of Object.entries(SAMPLES)) {
    it(`${name}`, () => {
      const validate = ajv.compile(TOOLS.find((t) => t.name === name)!.outputSchema as object);
      samples.forEach((sample, i) => {
        // Round-trip through JSON: that is what actually crosses the wire, and
        // it is where an undefined value quietly stops existing.
        const onTheWire = JSON.parse(JSON.stringify(sample));
        expect(validate(onTheWire), `${name}[${i}]: ${ajv.errorsText(validate.errors)}`).toBe(true);
      });
    });
  }
});

/**
 * The manifest keeps its own editorial one-liner per tool, which is right — but
 * the NAMES must not be a second, drifting copy. llms.txt used to carry one,
 * and it had been missing explore_and_debrief.
 */
describe("the machine manifest lists exactly the tools we serve", () => {
  it("same names, same order", () => {
    const manifest = (mcpManifest() as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(manifest).toEqual(TOOLS.map((t) => t.name));
  });
});
