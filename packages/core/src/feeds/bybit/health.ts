import type { BybitSystemStatusResponse } from './types.js';

export function deriveBybitHealth(
  status: BybitSystemStatusResponse | null,
  error?: unknown,
): { status: 'connected' | 'degraded'; message: string } {
  if (error != null) {
    return {
      status: 'degraded',
      message: `system status probe failed: ${String(error)}`,
    };
  }

  if (status == null || status.retCode !== 0) {
    return {
      status: 'degraded',
      message: 'system status probe failed',
    };
  }

  const active = status.result.list.find((item) => item.state === 'scheduled' || item.state === 'ongoing');
  if (active != null) {
    const title = active.title != null ? `: ${active.title}` : '';
    return {
      status: 'degraded',
      message: `system status ${active.state}${title}`,
    };
  }

  return {
    status: 'connected',
    message: 'system status healthy',
  };
}
