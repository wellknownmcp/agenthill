/**
 * Engine types. Everything is plain data: the engine is a pure function of
 * its inputs, and every input that could come from a clock or a random source
 * (timestamps, ids) is provided by the caller.
 */

export type Cents = number;
export type MoveKind = "PEACE" | "WAR" | "PASS";

/** An account is a human. Seniority (createdAt) is a public tie-breaker. */
export interface AccountInfo {
  /** Monotonic creation stamp (unix ms or a sequence) — earlier = more senior. */
  createdAt: number;
  /** Share of peaceful moves over the rolling window, 0..1. 0 when no history. */
  reputation: number;
}

export interface Mandate {
  dailyCapCents: Cents;
  maxStakeCents: Cents;
}

export interface Occupant {
  accountId: string;
  agentId: string;
  /** Consecutive days on THIS place, counted at the bell. 0 on the first night. */
  daysHeld: number;
}

export interface SlotState {
  occupants: Occupant[];
}

export interface DayState {
  /** Day index (the day whose moves are being collected). */
  day: number;
  /** slots[0] is place 1. */
  slots: SlotState[];
}

/** What an agent sends. */
export interface MoveInput {
  accountId: string;
  agentId: string;
  /** 1-based place number. */
  slot: number;
  move: MoveKind;
  stakeCents?: Cents;
  message?: string;
  /** Server receipt stamp — ordering only, never a clock read inside the engine. */
  receivedAt: number;
}

/** A validated move, with its cost frozen and held in escrow. */
export interface DepositedMove extends MoveInput {
  costCents: Cents;
  message?: string;
}

export type RefusalCode =
  | "INVALID_SLOT"
  | "INVALID_MOVE"
  | "MAX_MOVES_AGENT"
  | "MAX_MOVES_ACCOUNT"
  | "STAKE_TOO_LOW"
  | "STAKE_ABOVE_MANDATE"
  | "INSUFFICIENT_FUNDS"
  | "DAILY_CAP"
  | "MESSAGE_TOO_LONG";

export interface ValidationContext {
  state: DayState;
  /** Today's valid moves already deposited (all accounts). */
  deposited: DepositedMove[];
  /** Balance minus the escrows already held in `deposited` for this account. */
  availableCents: Cents;
  mandate?: Mandate;
}

export type ValidationResult =
  | { ok: true; move: DepositedMove | null; replaced: DepositedMove | null }
  | { ok: false; code: RefusalCode };

export type LedgerKind = "RENT" | "STAKE" | "BURN_STAKE";

export interface LedgerEntry {
  accountId: string;
  agentId: string;
  day: number;
  slot: number;
  kind: LedgerKind;
  cents: Cents;
  /** Part of `cents` funded by granted (free) credits. Never counts for the Wall. */
  grantedCents: Cents;
}

export interface PointsEntry {
  accountId: string;
  day: number;
  slot: number;
  /** 11 − slot, halved when shared. */
  points: number;
}

export type SlotOutcome = "VACANT" | "PEACE" | "WAR" | "BURN";

export interface SlotResolution {
  slot: number;
  outcome: SlotOutcome;
  peaceCount: number;
  warCount: number;
  occupants: Occupant[];
  evicted: Occupant[];
  burnedCents: Cents;
  /** Moves served from the global cooperators' queue (BURN case only). */
  fromQueue: DepositedMove[];
}

export interface ResolveInput {
  state: DayState;
  moves: DepositedMove[];
  accounts: Record<string, AccountInfo>;
  /** Granted credit balance per account at the bell; consumed first by debits. */
  grantedCents?: Record<string, Cents>;
}

export interface ResolveOutput {
  nextState: DayState;
  ledger: LedgerEntry[];
  points: PointsEntry[];
  slots: SlotResolution[];
  /** PEACE moves that obtained no place at all. */
  queueLeftovers: DepositedMove[];
}
