/**
 * Day arithmetic. A day is [00:00, 24:00[ UTC. Day 1 starts at LAUNCH_DATE.
 * The bell of day D runs at 00:00 UTC of day D+1 and resolves D's moves.
 */
const DAY_MS = 86_400_000;

export function launchEpochMs(launchDate: string): number {
  const [y, m, d] = launchDate.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function dayIndex(now: Date, launchDate: string): number {
  return Math.floor((now.getTime() - launchEpochMs(launchDate)) / DAY_MS) + 1;
}

export function nextBellAt(now: Date): Date {
  const t = now.getTime();
  return new Date(Math.floor(t / DAY_MS) * DAY_MS + DAY_MS);
}

export function dayWindow(day: number, launchDate: string): { start: Date; end: Date } {
  const start = launchEpochMs(launchDate) + (day - 1) * DAY_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}
