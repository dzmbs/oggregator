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
  const apiKey = localStorage.getItem('paperApiKey');
  if (apiKey) headers['X-API-Key'] = apiKey;
  return headers;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: getHeaders() });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(payload.message ?? payload.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(payload.message ?? payload.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function deleteRequest<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(payload.message ?? payload.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface PositionsResponse {
  accountId: string;
  positions: PositionLeg[];
}

export interface MetricsResponse {
  accountId: string;
  metrics: PortfolioMetrics | null;
  positions: PositionLeg[];
}

export interface ScenariosResponse {
  results: VolShockResult[];
}

export function fetchPositions(): Promise<PositionsResponse> {
  return getJson<PositionsResponse>('/portfolio/positions');
}

export function fetchMetrics(forwardDays: number): Promise<MetricsResponse> {
  const qs = forwardDays > 0 ? `?forwardDays=${forwardDays}` : '';
  return getJson<MetricsResponse>(`/portfolio/metrics${qs}`);
}

export function addPosition(input: PositionLegInput): Promise<{ leg: PositionLeg }> {
  return postJson<{ leg: PositionLeg }>('/portfolio/positions', input);
}

export function removePosition(legId: string): Promise<{ legId: string; removed: boolean }> {
  return deleteRequest<{ legId: string; removed: boolean }>(`/portfolio/positions/${legId}`);
}

export function runScenarios(scenarios: VolShockScenario[]): Promise<ScenariosResponse> {
  return postJson<ScenariosResponse>('/portfolio/scenarios', { scenarios });
}
