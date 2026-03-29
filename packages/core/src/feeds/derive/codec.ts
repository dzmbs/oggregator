import {
  DeriveHealthIncidentsSchema,
  DeriveHealthTimeSchema,
  DeriveInstrumentSchema,
  DeriveInstrumentsResponseSchema,
  DeriveTickerSchema,
  DeriveTickersResponseSchema,
  type DeriveHealthIncidents,
  type DeriveInstrument,
  type DeriveTicker,
  type DeriveTickersResponse,
} from './types.js';

export function parseDeriveInstrument(input: unknown): DeriveInstrument | null {
  const parsed = DeriveInstrumentSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseDeriveTicker(input: unknown): DeriveTicker | null {
  const parsed = DeriveTickerSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseDeriveInstrumentsResponse(input: unknown): DeriveInstrument[] {
  const parsed = DeriveInstrumentsResponseSchema.safeParse(input);
  return parsed.success ? parsed.data : [];
}

export function parseDeriveTickersResponse(input: unknown): DeriveTickersResponse | null {
  const parsed = DeriveTickersResponseSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseDeriveHealthTime(input: unknown): number | null {
  const parsed = DeriveHealthTimeSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseDeriveHealthIncidents(input: unknown): DeriveHealthIncidents | null {
  const parsed = DeriveHealthIncidentsSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
