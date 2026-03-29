import {
  BybitInstrumentsResponseSchema,
  BybitRestTickerSchema,
  BybitSystemStatusResponseSchema,
  BybitTickersResponseSchema,
  BybitWsMessageSchema,
  type BybitInstrumentsResponse,
  type BybitRestTicker,
  type BybitSystemStatusResponse,
  type BybitTickersResponse,
  type BybitWsMessage,
} from './types.js';

export function parseBybitInstrumentsResponse(input: unknown): BybitInstrumentsResponse | null {
  const parsed = BybitInstrumentsResponseSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseBybitTickersResponse(input: unknown): BybitTickersResponse | null {
  const parsed = BybitTickersResponseSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseBybitRestTicker(input: unknown): BybitRestTicker | null {
  const parsed = BybitRestTickerSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseBybitWsMessage(input: unknown): BybitWsMessage | null {
  const parsed = BybitWsMessageSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseBybitSystemStatusResponse(input: unknown): BybitSystemStatusResponse | null {
  const parsed = BybitSystemStatusResponseSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
