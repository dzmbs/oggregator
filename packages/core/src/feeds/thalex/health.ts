import type { ThalexSystemInfo } from './types.js';

/**
 * Derives venue health from the REST probe of `GET /public/system_info`
 * and the instrument load result.
 *
 *   - error       → degraded (network or parse failure)
 *   - no info     → degraded (parse returned null)
 *   - zero count  → degraded (instruments endpoint empty, venue is likely
 *                   in maintenance)
 *   - otherwise   → connected
 */
export function deriveThalexHealth(
  info: ThalexSystemInfo | null,
  instrumentCount: number,
  error?: unknown,
): { status: 'connected' | 'degraded'; message: string } {
  if (error != null) {
    return {
      status: 'degraded',
      message: `rest probe failed: ${String(error)}`,
    };
  }

  if (info == null) {
    return {
      status: 'degraded',
      message: 'system_info probe failed',
    };
  }

  if (instrumentCount <= 0) {
    return {
      status: 'degraded',
      message: 'no active instruments',
    };
  }

  return {
    status: 'connected',
    message: `rest health ok (${info.environment ?? 'unknown env'}, v${info.api_version ?? '?'})`,
  };
}
