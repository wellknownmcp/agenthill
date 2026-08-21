import type { Constants } from "./constants";
import { DEFAULT_CONSTANTS } from "./constants";
import { rentCents } from "./money";
import { normalizeText } from "./text";
import type { DepositedMove, MoveInput, ValidationContext, ValidationResult } from "./types";

const MOVES = new Set(["PEACE", "WAR", "PASS"]);

/**
 * Validates a move at deposit time (synchronous, before any escrow is held).
 * The cost is frozen here: a holder's PEACE costs today's rent, a challenger's
 * PEACE the floor, a WAR its stake. A later deposit by the same agent on the
 * same place REPLACES the earlier one (its escrow is released); PASS withdraws.
 */
export function validateMove(input: MoveInput, ctx: ValidationContext, c: Constants = DEFAULT_CONSTANTS): ValidationResult {
  if (!Number.isInteger(input.slot) || input.slot < 1 || input.slot > c.SLOTS) return { ok: false, code: "INVALID_SLOT" };
  if (!MOVES.has(input.move)) return { ok: false, code: "INVALID_MOVE" };

  const existing = ctx.deposited.find((m) => m.agentId === input.agentId && m.slot === input.slot) ?? null;

  if (input.move === "PASS") return { ok: true, move: null, replaced: existing };

  let message: string | undefined;
  if (input.message !== undefined) {
    const normalized = normalizeText(input.message);
    if (Array.from(normalized).length > c.MESSAGE_MAX_CHARS) return { ok: false, code: "MESSAGE_TOO_LONG" };
    if (normalized.length > 0) message = normalized;
  }

  const others = ctx.deposited.filter((m) => m !== existing);
  const agentSlots = new Set(others.filter((m) => m.agentId === input.agentId).map((m) => m.slot));
  if (!agentSlots.has(input.slot) && agentSlots.size >= c.MAX_MOVES_PER_DAY) return { ok: false, code: "MAX_MOVES_AGENT" };
  const accountMoves = others.filter((m) => m.accountId === input.accountId);
  if (accountMoves.length >= c.MAX_MOVES_PER_ACCOUNT_PER_DAY) return { ok: false, code: "MAX_MOVES_ACCOUNT" };

  const mandate = ctx.mandate ?? { dailyCapCents: c.DEFAULT_DAILY_CAP_CENTS, maxStakeCents: c.DEFAULT_MAX_STAKE_CENTS };

  let costCents: number;
  let stakeCents: number | undefined;
  if (input.move === "WAR") {
    const stake = input.stakeCents;
    if (typeof stake !== "number" || !Number.isInteger(stake) || stake < c.WAR_MIN_STAKE_CENTS) return { ok: false, code: "STAKE_TOO_LOW" };
    if (stake > mandate.maxStakeCents) return { ok: false, code: "STAKE_ABOVE_MANDATE" };
    costCents = stake;
    stakeCents = stake;
  } else {
    const slotState = ctx.state.slots[input.slot - 1];
    const holder = slotState?.occupants.find((o) => o.accountId === input.accountId);
    costCents = holder ? rentCents(holder.daysHeld, c) : c.RENT_FLOOR_CENTS;
  }

  const available = ctx.availableCents + (existing?.costCents ?? 0);
  if (costCents > available) return { ok: false, code: "INSUFFICIENT_FUNDS" };

  const spentToday = accountMoves.reduce((s, m) => s + m.costCents, 0);
  if (spentToday + costCents > mandate.dailyCapCents) return { ok: false, code: "DAILY_CAP" };

  const move: DepositedMove = {
    accountId: input.accountId,
    agentId: input.agentId,
    slot: input.slot,
    move: input.move,
    receivedAt: input.receivedAt,
    costCents,
  };
  if (stakeCents !== undefined) move.stakeCents = stakeCents;
  if (message !== undefined) move.message = message;
  return { ok: true, move, replaced: existing };
}
