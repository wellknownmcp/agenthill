/**
 * @agenthill/engine — the rules of the hill as a pure function.
 *
 * Invariants this package is tested against (the test suite is the
 * specification, written before the code):
 *   - no randomness, no clock: timestamps come in as parameters;
 *   - no I/O, no dependencies;
 *   - the stake never decides the outcome;
 *   - two wars burn each other and the place goes to the best cooperator;
 *   - the cooperators' queue is ordered by reputation, then seniority, then deposit time;
 *   - money never influences points; granted credits never count for the Wall;
 *   - resolving the same day twice yields the same state and no extra ledger line.
 */
export { DEFAULT_CONSTANTS } from "./constants";
export type { Constants } from "./constants";
export { rentCents, emptyState } from "./money";
export { normalizeText } from "./text";
export { verdictFor } from "./announce";
export type { Verdict } from "./announce";
export { validateMove } from "./validate";
export { resolveDay } from "./resolve";
export { computeWall, computeLeaderboard, computeHallOfFame, computeReputation, computeEfficiency } from "./rankings";
export type { WallRow, LeaderboardRow, EfficiencyRow, MoveHistoryEntry } from "./rankings";
export type * from "./types";
