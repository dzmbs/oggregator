import { z } from 'zod';

import type {
  PortfolioMetrics,
  PositionLeg,
  PositionLegInput,
  VolShockResult,
  VolShockScenario,
} from '@oggregator/protocol';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

function getHeaders(): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  let apiKey: string | null = null;
  try {
    apiKey = localStorage.getItem('paperApiKey');
  } catch (err) {
    console.error('localStorage access failed', err);
  }
  if (apiKey) headers['X-API-Key'] = apiKey;
  return headers;
}

async function parseResponse<T>(res: Response, schema: z.ZodType<T>, path: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const payload = (body ?? {}) as { message?: string; error?: string };
    throw new Error(payload.message ?? payload.error ?? `HTTP ${res.status}`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`invalid response from ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: getHeaders() });
  return parseResponse(res, schema, path);
}

async function postJson<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  return parseResponse(res, schema, path);
}

async function deleteRequest<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  return parseResponse(res, schema, path);
}

const VenueIdSchema = z.enum([
  'deribit',
  'okx',
  'bybit',
  'binance',
  'derive',
  'coincall',
  'thalex',
]);

const PositionLegSchema: z.ZodType<PositionLeg> = z.object({
  legId: z.string().min(1),
  underlying: z.string().min(1),
  expiry: z.string(),
  strike: z.number(),
  optionRight: z.enum(['call', 'put']),
  size: z.number(),
  entryPriceUsd: z.number(),
  entryIv: z.number().nullable(),
  entryTs: z.number(),
  venueHint: VenueIdSchema.nullable(),
  source: z.enum(['manual', 'paper', 'thalex-private']),
}) as z.ZodType<PositionLeg>;

export type PortfolioSource = 'manual' | 'paper';

const PortfolioSourceSchema = z.enum(['manual', 'paper']);

const PortfolioTotalsSchema = z.object({
  netDeltaUsd: z.number(),
  netGammaUsd: z.number(),
  netVegaUsd: z.number(),
  netThetaUsd: z.number(),
  netVannaUsd: z.number(),
  netVolgaUsd: z.number(),
  unrealizedPnlUsd: z.number(),
});

const VegaByStrikeRowSchema = z.object({
  strike: z.number(),
  expiry: z.string(),
  vega: z.number(),
  gamma: z.number(),
  vanna: z.number(),
  volga: z.number(),
  contracts: z.number(),
});

const ExpiryBucketRowSchema = z.object({
  expiry: z.string(),
  dte: z.number(),
  vega: z.number(),
  gamma: z.number(),
  theta: z.number(),
  contracts: z.number(),
});

const BreakEvenIvRowSchema = z.object({
  legId: z.string(),
  strike: z.number(),
  expiry: z.string(),
  optionRight: z.enum(['call', 'put']),
  entryIv: z.number().nullable(),
  currentMarkUsd: z.number().nullable(),
  currentIv: z.number().nullable(),
  breakEvenIv: z.number().nullable(),
  ivCushionPct: z.number().nullable(),
});

const ShockGridCellSchema = z.object({
  atmShiftVolPts: z.number(),
  skewShiftPerLogK: z.number(),
  totalPnlUsd: z.number(),
});

const PortfolioMetricsSchema: z.ZodType<PortfolioMetrics> = z.object({
  accountId: z.string(),
  generatedAt: z.number(),
  forwardDays: z.number(),
  totals: PortfolioTotalsSchema,
  byStrike: z.array(VegaByStrikeRowSchema),
  byExpiry: z.array(ExpiryBucketRowSchema),
  breakEven: z.array(BreakEvenIvRowSchema),
  shockGrid: z.array(z.array(ShockGridCellSchema)),
}) as z.ZodType<PortfolioMetrics>;

const VolShockLegResultSchema = z.object({
  legId: z.string(),
  pnlUsd: z.number(),
  bumpedIv: z.number(),
  bumpedMarkUsd: z.number(),
});

const VolShockScenarioSchema: z.ZodType<VolShockScenario> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('parallel'), bumpVolPts: z.number() }),
  z.object({ kind: z.literal('skew_tilt'), atmStrike: z.number(), slopePerLogK: z.number() }),
  z.object({ kind: z.literal('term_twist'), pivotDays: z.number(), slopePerYear: z.number() }),
  z.object({
    kind: z.literal('atm_bump'),
    atmStrike: z.number(),
    widthPct: z.number(),
    bumpVolPts: z.number(),
  }),
]) as z.ZodType<VolShockScenario>;

const VolShockResultSchema: z.ZodType<VolShockResult> = z.object({
  scenario: VolShockScenarioSchema,
  totalPnlUsd: z.number(),
  byLeg: z.array(VolShockLegResultSchema),
}) as z.ZodType<VolShockResult>;

const PositionsResponseSchema = z.object({
  accountId: z.string(),
  source: PortfolioSourceSchema.optional(),
  positions: z.array(PositionLegSchema),
});
export type PositionsResponse = z.infer<typeof PositionsResponseSchema>;

const MetricsResponseSchema = z.object({
  accountId: z.string(),
  source: PortfolioSourceSchema.optional(),
  metrics: PortfolioMetricsSchema.nullable(),
  positions: z.array(PositionLegSchema),
});
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

const ScenariosResponseSchema = z.object({
  results: z.array(VolShockResultSchema),
});
export type ScenariosResponse = z.infer<typeof ScenariosResponseSchema>;

const AddPositionResponseSchema = z.object({ leg: PositionLegSchema });
const RemovePositionResponseSchema = z.object({
  legId: z.string(),
  removed: z.boolean(),
});

export function fetchPositions(source: PortfolioSource = 'manual'): Promise<PositionsResponse> {
  return getJson(`/portfolio/positions?source=${source}`, PositionsResponseSchema);
}

export function fetchMetrics(
  forwardDays: number,
  source: PortfolioSource = 'manual',
): Promise<MetricsResponse> {
  const params = new URLSearchParams();
  if (forwardDays > 0) params.set('forwardDays', String(forwardDays));
  params.set('source', source);
  return getJson(`/portfolio/metrics?${params.toString()}`, MetricsResponseSchema);
}

export function addPosition(input: PositionLegInput): Promise<{ leg: PositionLeg }> {
  return postJson('/portfolio/positions', input, AddPositionResponseSchema);
}

export function removePosition(legId: string): Promise<{ legId: string; removed: boolean }> {
  const encoded = encodeURIComponent(legId);
  return deleteRequest(`/portfolio/positions/${encoded}`, RemovePositionResponseSchema);
}

export function runScenarios(
  scenarios: VolShockScenario[],
  source: PortfolioSource = 'manual',
): Promise<ScenariosResponse> {
  return postJson(`/portfolio/scenarios?source=${source}`, { scenarios }, ScenariosResponseSchema);
}
