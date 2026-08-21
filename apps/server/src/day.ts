/**
 * Day arithmetic. A day is [00:00, 24:00[ UTC. Day 1 starts at LAUNCH_DATE.
 * The bell of day D runs at 00:00 UTC of day D+1 and resolves D's moves.
 */
const DAY_MS = 86_400_000;

export function launchEpochMs(launchDate: string): number {
  const [y, m, d] = launchDate.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** Day 1 is the first day of the hill. Before it, the game has not started:
 *  everything reads day 1 and the surfaces say so, rather than pretending to
 *  run on a negative day. */
export function dayIndex(now: Date, launchDate: string): number {
  return Math.max(1, Math.floor((now.getTime() - launchEpochMs(launchDate)) / DAY_MS) + 1);
}

export function beforeLaunch(now: Date, launchDate: string): boolean {
  return now.getTime() < launchEpochMs(launchDate);
}

/** When the very first bell rings: 00:00 UTC at the end of day 1. */
export function firstBellAt(launchDate: string): Date {
  return new Date(launchEpochMs(launchDate) + DAY_MS);
}

export function nextBellAt(now: Date): Date {
  const t = now.getTime();
  return new Date(Math.floor(t / DAY_MS) * DAY_MS + DAY_MS);
}

export function dayWindow(day: number, launchDate: string): { start: Date; end: Date } {
  const start = launchEpochMs(launchDate) + (day - 1) * DAY_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}
