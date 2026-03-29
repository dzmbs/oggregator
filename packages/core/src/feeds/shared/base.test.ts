import { describe, expect, it } from 'vitest';
import { BaseAdapter } from './base.js';
import type { VenueCapabilities } from './types.js';
import type { VenueId } from '../../types/common.js';

class TestAdapter extends BaseAdapter {
  readonly venue: VenueId = 'binance';
  readonly capabilities: VenueCapabilities = {
    optionChain: true,
    greeks: true,
    websocket: true,
  };

  async loadMarkets(): Promise<void> {}
  async listUnderlyings(): Promise<string[]> { return []; }
  async listExpiries(): Promise<string[]> { return []; }
  async fetchOptionChain(): Promise<never> { throw new Error('not implemented'); }

  public parse(value: unknown): number | null {
    return this.safeNum(value);
  }
}

describe('BaseAdapter.safeNum', () => {
  const adapter = new TestAdapter();

  it('returns null for empty strings', () => {
    expect(adapter.parse('')).toBeNull();
    expect(adapter.parse('   ')).toBeNull();
  });

  it('returns null for nullish values', () => {
    expect(adapter.parse(null)).toBeNull();
    expect(adapter.parse(undefined)).toBeNull();
  });

  it('still parses valid numeric strings and numbers', () => {
    expect(adapter.parse('1.25')).toBe(1.25);
    expect(adapter.parse(42)).toBe(42);
  });
});
