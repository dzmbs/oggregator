import {
  DeribitBookSummarySchema,
  DeribitInstrumentSchema,
  DeribitInstrumentStateSchema,
  DeribitMarkPriceDataSchema,
  DeribitPlatformStateSchema,
  DeribitPriceIndexSchema,
  DeribitPublicStatusSchema,
  DeribitTickerSchema,
  type DeribitBookSummary,
  type DeribitInstrument,
  type DeribitInstrumentState,
  type DeribitMarkPriceItem,
  type DeribitPlatformState,
  type DeribitPriceIndex,
  type DeribitPublicStatus,
  type DeribitTicker,
} from './types.js';

export function parseDeribitInstrument(input: unknown): DeribitInstrument | null {
  const parsed = DeribitInstrumentSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseDeribitBookSummary(input: unknown): DeribitBookSummary | null {
  const parsed = DeribitBookSummarySchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseDeribitBookSummaries(input: unknown): DeribitBookSummary[] {
  if (!Array.isArray(input)) return [];

  const accepted: DeribitBookSummary[] = [];
  for (const item of input) {
    const parsed = parseDeribitBookSummary(item);
    if (parsed != null) accepted.push(parsed);
  }
  return accepted;
}

export function parseDeribitMarkPriceItems(input: unknown): DeribitMarkPriceItem[] {
  const parsed = DeribitMarkPriceDataSchema.safeParse(input);
  return parsed.success ? parsed.data : [];
}

export function parseDeribitTicker(input: unknown): DeribitTicker | null {
  const parsed = DeribitTickerSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseDeribitInstrumentState(input: unknown): DeribitInstrumentState | null {
  const parsed = DeribitInstrumentStateSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseDeribitPlatformState(input: unknown): DeribitPlatformState | null {
  const parsed = DeribitPlatformStateSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseDeribitPublicStatus(input: unknown): DeribitPublicStatus | null {
  const parsed = DeribitPublicStatusSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseDeribitPriceIndex(input: unknown): DeribitPriceIndex | null {
  const parsed = DeribitPriceIndexSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
