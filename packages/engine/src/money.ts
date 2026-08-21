import type { Constants } from "./constants";
import type { DayState } from "./types";

/** Holder rent after `daysHeld` consecutive days: ceil(floor × growth^daysHeld). */
export function rentCents(daysHeld: number, c: Constants): number {
  return Math.ceil(c.RENT_FLOOR_CENTS * Math.pow(c.RENT_GROWTH, daysHeld));
}

/** An empty hill for a given day. */
export function emptyState(day: number, c: Constants): DayState {
  return { day, slots: Array.from({ length: c.SLOTS }, () => ({ occupants: [] })) };
}
