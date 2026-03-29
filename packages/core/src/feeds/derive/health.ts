import type { DeriveHealthIncidents } from './types.js';

export interface DeriveHealthProbe {
  serverTime: number | null;
  incidents: DeriveHealthIncidents | null;
  error?: unknown;
}

export function deriveDeriveHealth(
  probe: DeriveHealthProbe,
): { status: 'connected' | 'degraded'; message: string } {
  if (probe.error != null) {
    return {
      status: 'degraded',
      message: `health probe failed: ${String(probe.error)}`,
    };
  }

  if (probe.serverTime == null) {
    return {
      status: 'degraded',
      message: 'time probe failed',
    };
  }

  const incidentCount = probe.incidents?.incidents.length ?? 0;
  if (incidentCount > 0) {
    return {
      status: 'degraded',
      message: `live incidents: ${incidentCount}`,
    };
  }

  return {
    status: 'connected',
    message: 'incident probe healthy',
  };
}
