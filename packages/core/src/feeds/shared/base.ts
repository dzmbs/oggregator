import type { OptionVenueAdapter, VenueCapabilities } from './types.js';
import type { ChainRequest, VenueOptionChain } from '../../core/types.js';
import type { VenueId } from '../../types/common.js';

export abstract class BaseAdapter implements OptionVenueAdapter {
  abstract readonly venue: VenueId;
  abstract readonly capabilities: VenueCapabilities;

  abstract loadMarkets(force?: boolean): Promise<void>;
  abstract listUnderlyings(): Promise<string[]>;
  abstract listExpiries(underlying: string): Promise<string[]>;
  abstract fetchOptionChain(request: ChainRequest): Promise<VenueOptionChain>;

  protected safeNum(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /** Convert IV from percentage (Deribit sends 50.18 for 50.18%) to fraction (0.5018). */
  protected ivToFraction(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n / 100 : null;
  }

  protected expiryMatchesDate(expiryMs: number, dateStr: string): boolean {
    const d = new Date(expiryMs);
    const iso = d.toISOString().slice(0, 10);
    return iso === dateStr;
  }
}
