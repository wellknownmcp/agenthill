/**
 * A11 — the engine contains no source of randomness or time, and has no
 * runtime dependency. A game of strategy, not of chance — checked, not declared.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = __dirname;
const FORBIDDEN = [/Math\.random/, /randomUUID/, /Date\.now/, /new Date\(/, /performance\.now/, /crypto\./, /from ["']node:/, /require\(/];

describe("A11 — no randomness, no clock, no dependencies in the engine", () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f} is pure`, () => {
      const text = readFileSync(join(SRC, f), "utf8");
      for (const re of FORBIDDEN) {
        expect(text, `${f} matches ${re}`).not.toMatch(re);
      }
    });
  }

  it("package.json declares no dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies ?? {})).toHaveLength(0);
  });
});
