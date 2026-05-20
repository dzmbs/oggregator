// Gate.io publishes official option settlement prices at
//   GET /api/v4/options/settlements?underlying={BASE}_USDT
// This is a PUBLIC endpoint (no signing needed). Each row covers one contract,
// but settle_price is the underlying index spot at expiration — identical for
// every contract sharing the same underlying+expiry. We fetch a window around
// the expiry timestamp and pick the first row whose contract matches.
//
// See references/options-docs/gateio/rest-settlements.json for endpoint shape.

import { feedLogger } from '../../utils/logger.js';
import { GATEIO_REST_BASE_URL } from '../shared/endpoints.js';
import { toGateioRestBase } from './aliases.js';
import { GateioSettlementsResponseSchema } from './types.js';

const log = feedLogger('gateio-settlement');

const REQUEST_TIMEOUT_MS = 10_000;
const WINDOW_BEFORE_MS = 24 * 60 * 60 * 1000;
const WINDOW_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface GateioSettlementResult {
  priceUsd: number;
  capturedAt: Date;
  sampleContract: string;
}

export interface FetchGateioSettlementArgs {
  underlying: string;
  expiry: string;
  now?: () => number;
}

export async function fetchGateioSettlement(
  args: FetchGateioSettlementArgs,
): Promise<GateioSettlementResult | null> {
  const { underlying, expiry } = args;

  const expiryMs = Date.parse(`${expiry}T08:00:00Z`);
  if (!Number.isFinite(expiryMs)) {
    log.warn({ underlying, expiry }, 'invalid expiry');
    return null;
  }

  const nowMs = args.now?.() ?? Date.now();
  if (expiryMs > nowMs) return null;

  const restBase = toGateioRestBase(underlying);
  const contractPrefix = `${restBase}_USDT-${expiry.replace(/-/g, '')}-`;

  const fromSec = Math.floor((expiryMs - WINDOW_BEFORE_MS) / 1000);
  const toSec = Math.floor((expiryMs + WINDOW_AFTER_MS) / 1000);
  const params = new URLSearchParams({
    underlying: `${restBase}_USDT`,
    from: String(fromSec),
    to: String(toSec),
    limit: '1000',
  });
  const url = `${GATEIO_REST_BASE_URL}/api/v4/options/settlements?${params}`;

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    log.warn({ underlying, expiry, err: String(err) }, 'gateio settlements fetch failed');
    return null;
  }
  if (!res.ok) {
    log.warn({ underlying, expiry, status: res.status }, 'gateio settlements http error');
    return null;
  }

  const parsed = GateioSettlementsResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    log.warn({ underlying, expiry, issues: parsed.error.issues }, 'gateio settlements parse failed');
    return null;
  }

  const match = parsed.data.find((row) => row.contract.startsWith(contractPrefix));
  if (!match) return null;

  const priceUsd = Number(match.settle_price);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    log.warn({ underlying, expiry, settle_price: match.settle_price }, 'gateio settle_price unusable');
    return null;
  }

  return {
    priceUsd,
    capturedAt: new Date(match.time * 1000),
    sampleContract: match.contract,
  };
}
