import { type ZodError, type ZodType } from 'zod';
import {
  GateioContractsResponseSchema,
  GateioExpirationsResponseSchema,
  GateioOrderBookSchema,
  GateioTickersResponseSchema,
  GateioUnderlyingTickerSchema,
  GateioUnderlyingsResponseSchema,
  GateioWsContractTickerSchema,
  GateioWsEnvelopeSchema,
  GateioWsOrderBookUpdateSchema,
  GateioWsTradeSchema,
  GateioWsUnderlyingTickerSchema,
  type GateioContract,
  type GateioOrderBook,
  type GateioTicker,
  type GateioUnderlying,
  type GateioUnderlyingTicker,
  type GateioWsEnvelope,
  type GateioWsOrderBookUpdate,
  type GateioWsTrade,
  type GateioWsUnderlyingTicker,
} from './types.js';

function parse<T>(schema: ZodType<T>, raw: unknown, label: string): T {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issue = (r.error as ZodError).issues[0];
    const path = issue?.path?.join('.') ?? '<root>';
    throw new Error(`gateio: invalid ${label} at ${path}: ${issue?.message ?? 'unknown'}`);
  }
  return r.data as T;
}

export function parseGateioUnderlyings(raw: unknown): GateioUnderlying[] {
  return parse(GateioUnderlyingsResponseSchema, raw, 'underlyings');
}
export function parseGateioExpirations(raw: unknown): number[] {
  return parse(GateioExpirationsResponseSchema, raw, 'expirations');
}
export function parseGateioContracts(raw: unknown): GateioContract[] {
  return parse(GateioContractsResponseSchema, raw, 'contracts');
}
export function parseGateioTickers(raw: unknown): GateioTicker[] {
  return parse(GateioTickersResponseSchema, raw, 'tickers');
}
export function parseGateioUnderlyingTicker(raw: unknown): GateioUnderlyingTicker {
  return parse(GateioUnderlyingTickerSchema, raw, 'underlying-ticker');
}
export function parseGateioOrderBook(raw: unknown): GateioOrderBook {
  return parse(GateioOrderBookSchema, raw, 'order-book');
}

export type GateioWsParsed =
  | { kind: 'contract_ticker'; data: GateioTicker }
  | { kind: 'trade'; data: GateioWsTrade[] }
  | { kind: 'order_book_update'; data: GateioWsOrderBookUpdate }
  | { kind: 'underlying_ticker'; data: GateioWsUnderlyingTicker }
  | { kind: 'ack'; channel: string; status: string }
  | { kind: 'error'; channel: string; code?: number; message?: string }
  | { kind: 'pong' }
  | { kind: 'ignore' };

export function parseGateioWsMessage(raw: unknown): GateioWsParsed {
  let envelope: GateioWsEnvelope;
  try {
    envelope = parse(GateioWsEnvelopeSchema, raw, 'ws-envelope');
  } catch {
    return { kind: 'ignore' };
  }

  if (envelope.event === 'pong' || envelope.channel.endsWith('.ping')) {
    return { kind: 'pong' };
  }

  if (envelope.error != null) {
    const err = envelope.error as { code?: number; message?: string };
    return {
      kind: 'error',
      channel: envelope.channel,
      ...(err.code !== undefined && { code: err.code }),
      ...(err.message !== undefined && { message: err.message }),
    };
  }

  if (envelope.event === 'subscribe' || envelope.event === 'unsubscribe') {
    const status = (envelope.result as { status?: string } | undefined)?.status ?? 'unknown';
    return { kind: 'ack', channel: envelope.channel, status };
  }

  switch (envelope.channel) {
    case 'options.contract_tickers':
      return { kind: 'contract_ticker', data: GateioWsContractTickerSchema.parse(envelope.result) };
    case 'options.trades':
      return { kind: 'trade', data: GateioWsTradeSchema.array().parse(envelope.result) };
    case 'options.order_book_update':
      return {
        kind: 'order_book_update',
        data: GateioWsOrderBookUpdateSchema.parse(envelope.result),
      };
    case 'options.underlying_tickers':
      return {
        kind: 'underlying_ticker',
        data: GateioWsUnderlyingTickerSchema.parse(envelope.result),
      };
    default:
      return { kind: 'ignore' };
  }
}
