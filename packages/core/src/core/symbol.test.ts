/**
 * Core symbol utilities — doc-driven contract tests
 *
 * Tests parseOptionSymbol, formatOptionSymbol, and strikeKey against the
 * canonical CCXT unified option symbol format:
 *
 *   BASE/QUOTE:SETTLE-YYMMDD-STRIKE-RIGHT
 *   e.g. BTC/USD:BTC-250628-60000-C
 *
 * This format is what the aggregator uses internally to represent options
 * across all venues (OKX, Binance, Bybit) in a venue-agnostic way.
 */

import { describe, it, expect } from 'vitest';
import { parseOptionSymbol, formatOptionSymbol, strikeKey } from './symbol.js';
import type { CanonicalOption } from './symbol.js';

// ---------------------------------------------------------------------------
// parseOptionSymbol
// ---------------------------------------------------------------------------

describe('parseOptionSymbol', () => {
  it('parses a canonical BTC call option symbol into correct parts', () => {
    // Arrange
    const symbol = 'BTC/USD:BTC-250628-60000-C';

    // Act
    const result = parseOptionSymbol(symbol);

    // Assert
    expect(result).not.toBeNull();
    expect(result?.base).toBe('BTC');
    expect(result?.quote).toBe('USD');
    expect(result?.settle).toBe('BTC');
    expect(result?.expiryCode).toBe('250628');
    expect(result?.strike).toBe(60000);
    expect(result?.right).toBe('call');
  });

  it('derives the full ISO expiry date from the 6-digit expiry code', () => {
    // Arrange — expiryCode 250628 = June 28 2025
    const symbol = 'BTC/USD:BTC-250628-60000-C';

    // Act
    const result = parseOptionSymbol(symbol);

    // Assert
    expect(result?.expiry).toBe('2025-06-28');
  });

  it('parses a put option and maps right to "put"', () => {
    // Arrange
    const symbol = 'BTC/USD:BTC-250628-60000-P';

    // Act
    const result = parseOptionSymbol(symbol);

    // Assert
    expect(result).not.toBeNull();
    expect(result?.right).toBe('put');
  });

  it('parses an ETH option with USDT quote and ETH settle', () => {
    // Arrange
    const symbol = 'ETH/USD:ETH-260328-2500-P';

    // Act
    const result = parseOptionSymbol(symbol);

    // Assert
    expect(result).not.toBeNull();
    expect(result?.base).toBe('ETH');
    expect(result?.quote).toBe('USD');
    expect(result?.settle).toBe('ETH');
    expect(result?.strike).toBe(2500);
    expect(result?.right).toBe('put');
  });

  it('parses strike as a number, not a string', () => {
    // Arrange — internal representation must be numeric for arithmetic
    const symbol = 'BTC/USD:BTC-250628-70000-C';

    // Act
    const result = parseOptionSymbol(symbol);

    // Assert
    expect(result).not.toBeNull();
    expect(typeof result?.strike).toBe('number');
    expect(result?.strike).toBe(70000);
  });

  it('correctly computes expiry for a December expiry', () => {
    // Arrange — expiryCode 251225 = December 25 2025
    const symbol = 'BTC/USD:BTC-251225-80000-C';

    // Act
    const result = parseOptionSymbol(symbol);

    // Assert
    expect(result?.expiry).toBe('2025-12-25');
    expect(result?.expiryCode).toBe('251225');
  });

  it('correctly computes expiry for a year 2026 expiry', () => {
    // Arrange — expiryCode 260328 = March 28 2026
    const symbol = 'BTC/USD:BTC-260328-60000-C';

    // Act
    const result = parseOptionSymbol(symbol);

    // Assert
    expect(result?.expiry).toBe('2026-03-28');
  });

  it('returns null for a symbol missing the colon separator', () => {
    // Arrange — CCXT format requires BASE/QUOTE:SETTLE-...
    const symbol = 'BTC/USD/BTC-250628-60000-C';

    // Act
    const result = parseOptionSymbol(symbol);

    // Assert
    expect(result).toBeNull();
  });

  it('returns null for a symbol missing the slash between base and quote', () => {
    // Arrange
    const symbol = 'BTCUSD:BTC-250628-60000-C';

    // Act
    const result = parseOptionSymbol(symbol);

    // Assert
    expect(result).toBeNull();
  });

  it('returns null for a symbol with a non-6-digit expiry code', () => {
    // Arrange — 5-digit expiry code is invalid
    const symbol = 'BTC/USD:BTC-25628-60000-C';

    // Act
    const result = parseOptionSymbol(symbol);

    // Assert
    expect(result).toBeNull();
  });

  it('returns null for a symbol with an invalid option type character', () => {
    // Arrange — only C and P are valid
    const symbol = 'BTC/USD:BTC-250628-60000-X';

    // Act
    const result = parseOptionSymbol(symbol);

    // Assert
    expect(result).toBeNull();
  });

  it('returns null for an OKX-style symbol (no CCXT format)', () => {
    // Arrange — OKX uses BTC-USD-260321-70000-C, not the CCXT format
    const symbol = 'BTC-USD-260321-70000-C';

    // Act
    const result = parseOptionSymbol(symbol);

    // Assert
    expect(result).toBeNull();
  });

  it('returns null for a Bybit-style symbol (no CCXT format)', () => {
    // Arrange — Bybit uses BTC-21MAR26-70000-C-USDT, not the CCXT format
    const symbol = 'BTC-21MAR26-70000-C-USDT';

    // Act
    const result = parseOptionSymbol(symbol);

    // Assert
    expect(result).toBeNull();
  });

  it('returns null for an empty string', () => {
    // Arrange
    const symbol = '';

    // Act
    const result = parseOptionSymbol(symbol);

    // Assert
    expect(result).toBeNull();
  });

  it('returns null for a plain spot symbol', () => {
    // Arrange — BTC/USD has no option parts
    const symbol = 'BTC/USD';

    // Act
    const result = parseOptionSymbol(symbol);

    // Assert
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatOptionSymbol
// ---------------------------------------------------------------------------

describe('formatOptionSymbol', () => {
  it('produces the expected CCXT canonical string for a call option', () => {
    // Arrange
    const opt: CanonicalOption = {
      base: 'BTC',
      quote: 'USD',
      settle: 'BTC',
      expiry: '2025-06-28',
      expiryCode: '250628',
      strike: 60000,
      right: 'call',
    };

    // Act
    const result = formatOptionSymbol(opt);

    // Assert
    expect(result).toBe('BTC/USD:BTC-250628-60000-C');
  });

  it('produces the expected CCXT canonical string for a put option', () => {
    // Arrange
    const opt: CanonicalOption = {
      base: 'BTC',
      quote: 'USD',
      settle: 'BTC',
      expiry: '2025-06-28',
      expiryCode: '250628',
      strike: 60000,
      right: 'put',
    };

    // Act
    const result = formatOptionSymbol(opt);

    // Assert
    expect(result).toBe('BTC/USD:BTC-250628-60000-P');
  });

  it('uses "C" for call and "P" for put in the output', () => {
    // Arrange
    const base: CanonicalOption = {
      base: 'ETH',
      quote: 'USD',
      settle: 'ETH',
      expiry: '2026-03-28',
      expiryCode: '260328',
      strike: 2500,
      right: 'call',
    };

    // Act
    const callResult = formatOptionSymbol(base);
    const putResult = formatOptionSymbol({ ...base, right: 'put' });

    // Assert
    expect(callResult.endsWith('-C')).toBe(true);
    expect(putResult.endsWith('-P')).toBe(true);
  });

  it('round-trips: parse then format returns the original symbol', () => {
    // Arrange — the composition parseOptionSymbol ∘ formatOptionSymbol must be identity
    const original = 'BTC/USD:BTC-250628-60000-C';

    // Act
    const parsed = parseOptionSymbol(original);
    const reformatted = parsed !== null ? formatOptionSymbol(parsed) : null;

    // Assert
    expect(reformatted).toBe(original);
  });

  it('round-trips for a put option symbol', () => {
    // Arrange
    const original = 'ETH/USD:ETH-260328-2500-P';

    // Act
    const parsed = parseOptionSymbol(original);
    const reformatted = parsed !== null ? formatOptionSymbol(parsed) : null;

    // Assert
    expect(reformatted).toBe(original);
  });

  it('round-trips for a December 2025 expiry', () => {
    // Arrange
    const original = 'BTC/USD:BTC-251225-80000-C';

    // Act
    const parsed = parseOptionSymbol(original);
    const reformatted = parsed !== null ? formatOptionSymbol(parsed) : null;

    // Assert
    expect(reformatted).toBe(original);
  });

  it('includes the strike as an integer (no decimal point)', () => {
    // Arrange — strike 60000 should appear as "60000", not "60000.0"
    const opt: CanonicalOption = {
      base: 'BTC',
      quote: 'USD',
      settle: 'BTC',
      expiry: '2025-06-28',
      expiryCode: '250628',
      strike: 60000,
      right: 'call',
    };

    // Act
    const result = formatOptionSymbol(opt);

    // Assert
    expect(result).toContain('-60000-');
    expect(result).not.toContain('60000.0');
  });
});

// ---------------------------------------------------------------------------
// strikeKey
// ---------------------------------------------------------------------------

describe('strikeKey', () => {
  it('generates a key in base:expiry:strike format', () => {
    // Arrange
    const base = 'BTC';
    const expiry = '2025-06-28';
    const strike = 60000;

    // Act
    const result = strikeKey(base, expiry, strike);

    // Assert
    expect(result).toBe('BTC:2025-06-28:60000');
  });

  it('generates the same key for the same strike regardless of call or put', () => {
    // Arrange — strikeKey groups calls AND puts at the same strike together
    const base = 'BTC';
    const expiry = '2025-06-28';
    const strike = 60000;

    // Act
    const key = strikeKey(base, expiry, strike);

    // Assert — there is no right ('C'/'P') component in the key
    expect(key).not.toContain('call');
    expect(key).not.toContain('put');
    expect(key).not.toContain('-C');
    expect(key).not.toContain('-P');
    expect(key).toBe('BTC:2025-06-28:60000');
  });

  it('generates different keys for different strikes at the same expiry', () => {
    // Arrange
    const base = 'BTC';
    const expiry = '2025-06-28';

    // Act
    const key60k = strikeKey(base, expiry, 60000);
    const key70k = strikeKey(base, expiry, 70000);

    // Assert
    expect(key60k).not.toBe(key70k);
    expect(key60k).toBe('BTC:2025-06-28:60000');
    expect(key70k).toBe('BTC:2025-06-28:70000');
  });

  it('generates different keys for the same strike at different expiries', () => {
    // Arrange
    const base = 'BTC';
    const strike = 60000;

    // Act
    const keyJun = strikeKey(base, '2025-06-28', strike);
    const keyDec = strikeKey(base, '2025-12-25', strike);

    // Assert
    expect(keyJun).not.toBe(keyDec);
    expect(keyJun).toBe('BTC:2025-06-28:60000');
    expect(keyDec).toBe('BTC:2025-12-25:60000');
  });

  it('generates different keys for different base assets at the same expiry and strike', () => {
    // Arrange
    const expiry = '2025-06-28';
    const strike = 60000;

    // Act
    const btcKey = strikeKey('BTC', expiry, strike);
    const ethKey = strikeKey('ETH', expiry, strike);

    // Assert
    expect(btcKey).not.toBe(ethKey);
    expect(btcKey).toBe('BTC:2025-06-28:60000');
    expect(ethKey).toBe('ETH:2025-06-28:60000');
  });

  it('uses colons as separators making the format unambiguous', () => {
    // Arrange — verify exact separator character
    const result = strikeKey('BTC', '2025-06-28', 60000);

    // Act — split on colon
    const parts = result.split(':');

    // Assert
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('BTC');
    expect(parts[1]).toBe('2025-06-28');
    expect(parts[2]).toBe('60000');
  });

  it('produces a deterministic key usable as a Map or Record key', () => {
    // Arrange — same inputs always produce same output (pure function)
    const base = 'BTC';
    const expiry = '2026-03-28';
    const strike = 70000;

    // Act
    const key1 = strikeKey(base, expiry, strike);
    const key2 = strikeKey(base, expiry, strike);

    // Assert
    expect(key1).toBe(key2);
  });
});
