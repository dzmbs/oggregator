import {
  BinanceCombinedStreamSchema,
  BinanceHealthExchangeInfoSchema,
  BinanceHealthTimeSchema,
  BinanceInstrumentSchema,
  BinanceMarkPriceSchema,
  BinanceNewSymbolSchema,
  BinanceOiEventSchema,
  BinanceRestTickerSchema,
  type BinanceCombinedStream,
  type BinanceHealthExchangeInfo,
  type BinanceInstrument,
  type BinanceMarkPrice,
  type BinanceNewSymbol,
  type BinanceOiEvent,
  type BinanceRestTicker,
} from './types.js';

export function parseBinanceCombinedStream(input: unknown): BinanceCombinedStream | null {
  const parsed = BinanceCombinedStreamSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseBinanceInstrument(input: unknown): BinanceInstrument | null {
  const parsed = BinanceInstrumentSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseBinanceMarkPrice(input: unknown): BinanceMarkPrice | null {
  const parsed = BinanceMarkPriceSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseBinanceNewSymbol(input: unknown): BinanceNewSymbol | null {
  const parsed = BinanceNewSymbolSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseBinanceOiEvent(input: unknown): BinanceOiEvent | null {
  const parsed = BinanceOiEventSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseBinanceRestTicker(input: unknown): BinanceRestTicker | null {
  const parsed = BinanceRestTickerSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseBinanceHealthTime(input: unknown): number | null {
  const parsed = BinanceHealthTimeSchema.safeParse(input);
  return parsed.success ? parsed.data.serverTime : null;
}

export function parseBinanceHealthExchangeInfo(input: unknown): BinanceHealthExchangeInfo | null {
  const parsed = BinanceHealthExchangeInfoSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
