/**
 * @agenthill/engine — the rules of the hill as a pure function.
 *
 * Invariants this package is tested against (see the repository README and
 * the test suite, which is the specification):
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
