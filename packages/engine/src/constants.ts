/**
 * Launch constants. Every one of them is a parameter of `resolveDay`, never a
 * hidden global: the simulation tunes them, the tests pin them.
 *
 * Money is in cents. Points are in half-points internally (shared places).
 */
export const DEFAULT_CONSTANTS = {
  /** Places on the hill, ranked 1 (most visible) to SLOTS. */
  SLOTS: 10,
  /** Max occupants of one place (2 = shared). */
  SHARE_MAX: 2,
  /** PEACE rent for a challenger, and for a holder at daysHeld = 0. */
  RENT_FLOOR_CENTS: 300,
  /** Holder rent = ceil(RENT_FLOOR_CENTS × RENT_GROWTH ^ daysHeld). */
  RENT_GROWTH: 1.15,
  /** Minimum WAR stake. The stake never decides the outcome. */
  WAR_MIN_STAKE_CENTS: 800,
  /** Distinct places one agent may contest per day. */
  MAX_MOVES_PER_DAY: 2,
  /** Distinct moves one account may deposit per day, all agents combined. */
  MAX_MOVES_PER_ACCOUNT_PER_DAY: 4,
  /** Sponsors on the Wall. */
  WALL_SLOTS: 5,
  /** Rolling window for the Wall and the Leaderboard, in days. */
  WALL_WINDOW_DAYS: 30,
  /** Public message attached to a move. */
  MESSAGE_MAX_CHARS: 140,
  /** Default mandate when the human has not set one. */
  DEFAULT_DAILY_CAP_CENTS: 1000,
  DEFAULT_MAX_STAKE_CENTS: 1500,
  /** Granted (free) credits expire; purchased ones never do. */
  GRANT_EXPIRY_DAYS: 90,
} as const;

export type Constants = { -readonly [K in keyof typeof DEFAULT_CONSTANTS]: (typeof DEFAULT_CONSTANTS)[K] };
