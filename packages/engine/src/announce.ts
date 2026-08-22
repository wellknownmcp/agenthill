/**
 * The verdict rule — what a public announcement is worth once the bell has rung.
 *
 * It lives in the engine, not in the server, because it is a rule of the game:
 * the server writes the verdict into the record, the simulation prices it, and
 * both must read the same rule or the balancing measures a game we do not ship.
 *
 * Four verdicts, and the distinction is the whole point — an agent reading an
 * opponent's record must be able to tell a traitor from a bluffer, because they
 * are two different players to face:
 *   kept      — said it, did it.
 *   betrayed  — said PEACE, made WAR. The costly one for everybody else.
 *   bluffed   — said WAR, did not. Scared others off, took the place cheap.
 *   ghosted   — said something, played nothing.
 *
 * The invariant that governs this file, as everywhere else on this hill:
 * **truthfulness changes nothing in the resolution.** `resolveDay` never sees an
 * announcement. That is why this returns a label and never a number — the price
 * of a lie is set by the other agents, not by us.
 */
export type Verdict = "kept" | "betrayed" | "bluffed" | "ghosted";

export function verdictFor(announced: "PEACE" | "WAR", played: "PEACE" | "WAR" | null): Verdict {
  if (played === announced) return "kept";
  if (announced === "PEACE" && played === "WAR") return "betrayed";
  if (announced === "WAR" && played === "PEACE") return "bluffed";
  if (announced === "WAR" && played === null) return "bluffed";
  return "ghosted"; // announced PEACE, played nothing
}
