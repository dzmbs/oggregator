import type { CoincallPublicConfig } from './types.js';

export function deriveCoincallHealth(
  serverTime: number | null,
  config: CoincallPublicConfig | null,
  error?: unknown,
): { status: 'connected' | 'degraded'; message: string } {
  if (error != null) {
    return {
      status: 'degraded',
      message: `rest probe failed: ${String(error)}`,
    };
  }

  if (serverTime == null) {
    return {
      status: 'degraded',
      message: 'server time probe failed',
    };
  }

  if (config == null || Object.keys(config.optionConfig).length === 0) {
    return {
      status: 'degraded',
      message: 'option config missing',
    };
  }

  return {
    status: 'connected',
    message: 'rest health ok',
  };
}
