import type { AccountId } from '../book/account.js';
import type { Fill } from '../book/fill.js';
import { fillCashDelta } from '../book/fill.js';
import { applyFillToPosition, keyFromFill, type Position } from '../book/position.js';
import type { PositionRepository } from '../gateways/position-repository.js';

/**
 * Atomic for a single fill:
 *  1. Load prior position for the (account, symbol) key
 *  2. Fold the fill into it
 *  3. Persist the new position + cash ledger entry
 */
export async function applyFill(
  positions: PositionRepository,
  accountId: AccountId,
  fill: Fill,
): Promise<Position> {
  const all = await positions.listPositions(accountId);
  const key = keyFromFill(accountId, fill);
  const prior = all.find((p) => positionMatches(p, key)) ?? null;
  const next = applyFillToPosition(
    prior ? { ...prior, key: prior.key } : null,
    fill,
  );
  const nextWithAccount: Position = { ...next, key: { ...next.key, accountId } };

  await positions.upsertPosition(nextWithAccount);
  await positions.appendCashLedger({
    accountId,
    deltaUsd: fillCashDelta(fill),
    reason: 'fill',
    refId: fill.id,
    ts: fill.filledAt,
  });

  return nextWithAccount;
}

function positionMatches(pos: Position, key: Position['key']): boolean {
  return (
    pos.key.accountId === key.accountId &&
    pos.key.underlying === key.underlying &&
    pos.key.expiry === key.expiry &&
    pos.key.strike === key.strike &&
    pos.key.optionRight === key.optionRight
  );
}
