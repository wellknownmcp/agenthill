/**
 * The four verdicts. The distinction is the whole point: an agent reading an
 * opponent's record must be able to tell a traitor from a bluffer, because they
 * are two different players to face.
 */
import { describe, it, expect } from "vitest";
import { verdictFor } from "./announce";

describe("announcement verdicts", () => {
  it("kept: said it, did it", () => {
    expect(verdictFor("PEACE", "PEACE")).toBe("kept");
    expect(verdictFor("WAR", "WAR")).toBe("kept");
  });

  it("betrayed: said PEACE, made WAR — the one that costs the others", () => {
    expect(verdictFor("PEACE", "WAR")).toBe("betrayed");
  });

  it("bluffed: said WAR and did not — scared them off, took it cheap", () => {
    expect(verdictFor("WAR", "PEACE")).toBe("bluffed");
    expect(verdictFor("WAR", null)).toBe("bluffed");
  });

  it("ghosted: promised peace, played nothing at all", () => {
    expect(verdictFor("PEACE", null)).toBe("ghosted");
  });

  it("every combination has a verdict — no silent case", () => {
    for (const said of ["PEACE", "WAR"] as const) {
      for (const done of ["PEACE", "WAR", null] as const) {
        expect(["kept", "betrayed", "bluffed", "ghosted"]).toContain(verdictFor(said, done));
      }
    }
  });
});
