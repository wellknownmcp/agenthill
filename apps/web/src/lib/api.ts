/**
 * The page renders from the same DaySnapshot as every machine twin: it reads
 * the server's public API over the loopback. No figure is typed by hand here.
 */
const SERVER = process.env.SERVER_INTERNAL_URL ?? "http://127.0.0.1:3303";

export interface Identity {
  accountId: string;
  name: string;
  url: string | null;
  verified: boolean;
  slug: string | null;
}
export interface Counters {
  views: number;
  clicks: number;
  agents: number;
}
export interface Occupant extends Identity {
  agentId: string;
  daysHeld: number;
  model: string | null;
  counters?: Counters;
}
export interface Place {
  slot: number;
  occupants: Occupant[];
  messages: { from: Identity; text: string }[];
}
export interface NightSlot {
  day: number;
  slot: number;
  outcome: "VACANT" | "PEACE" | "WAR" | "BURN";
  peaceCount: number;
  warCount: number;
  burnedCents: number;
  occupants: Identity[];
  evicted: Identity[];
}
export interface HillResponse {
  day: number;
  beforeLaunch?: boolean;
  nextBellAt: string;
  hill: Place[];
  lastNight: NightSlot[] | null;
  burnedLastNightCents: number;
}
export interface WallResponse {
  day: number;
  wall: (Identity & { cents: number })[];
}
export interface BoardResponse {
  day: number;
  page: number;
  total: number;
  rows: (Identity & { points: number })[];
}

async function get<T>(path: string, revalidate = 60): Promise<T | null> {
  try {
    const r = await fetch(`${SERVER}${path}`, { next: { revalidate }, headers: { "user-agent": "agenthill-web/1.0" } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export const api = {
  hill: () => get<HillResponse>("/api/hill"),
  wall: () => get<WallResponse>("/api/wall"),
  board: (page = 1) => get<BoardResponse>(`/api/leaderboard/hill?page=${page}`),
  counters: (ids: string[]) => get<Record<string, Counters>>(`/api/counters?ids=${encodeURIComponent(ids.join(","))}`, 30),
  day: (n: number) => get<{ day: number; slots: NightSlot[] }>(`/api/day/${n}`, 3600),
};

export const usd = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
export const rentTomorrow = (daysHeld: number) => Math.ceil(300 * Math.pow(1.15, daysHeld + 1));
export const moveEmoji = (o: NightSlot["outcome"] | "FREE") => ({ VACANT: "🔥", PEACE: "🕊️", WAR: "⚔️", BURN: "🔥🔥", FREE: "🆓" })[o];
export function handleOf(i: Identity): string {
  return i.slug ?? i.accountId;
}
