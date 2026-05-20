import type { AccountId } from '../book/account.js';

export interface PortfolioGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

/**
 * Stub — real body lands alongside the analytics feature. The shape matches
 * what enrichment.computeChainStats already surfaces per strike, so aggregation
 * is a sum across open positions weighted by net quantity.
 */
export async function computePortfolioGreeks(
  _accountId: AccountId,
): Promise<PortfolioGreeks> {
  return { delta: 0, gamma: 0, theta: 0, vega: 0 };
}
