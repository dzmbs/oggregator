import type { AccountId } from '../book/account.js';
import { computeSnapshot, type PnlSnapshot } from '../book/pnl.js';
import type { Clock } from '../gateways/clock.js';
import type { PositionRepository } from '../gateways/position-repository.js';
import type { QuoteProvider } from '../gateways/quote-provider.js';

export class PnlService {
  constructor(
    private readonly positions: PositionRepository,
    private readonly quotes: QuoteProvider,
    private readonly clock: Clock,
  ) {}

  async snapshot(accountId: AccountId): Promise<PnlSnapshot> {
    const [open, cash] = await Promise.all([
      this.positions.listPositions(accountId),
      this.positions.getCashBalance(accountId),
    ]);

    const marks = new Map<string, number | null>();
    await Promise.all(
      open.map(async (p) => {
        if (p.netQuantity === 0) return;
        const mark = await this.quotes.getMark({
          underlying: p.key.underlying,
          expiry: p.key.expiry,
          strike: p.key.strike,
          optionRight: p.key.optionRight,
        });
        const k = `${p.key.underlying}|${p.key.expiry}|${p.key.strike}|${p.key.optionRight}`;
        marks.set(k, mark);
      }),
    );

    return computeSnapshot(open, marks, cash, this.clock.now());
  }
}
