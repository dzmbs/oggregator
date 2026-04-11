import { monitorEventLoopDelay } from 'node:perf_hooks';
import { logger } from './logger.js';

const NS_PER_MS = 1_000_000;

/**
 * Samples Node's event loop delay histogram and logs a warning whenever the
 * p99 in the last window exceeds `thresholdP99Ms`. High event loop lag is the
 * symptom we need to confirm or rule out when diagnosing heartbeat-close cycles
 * on high-channel-count WebSocket feeds — if p99 stays low while the Deribit
 * connection dies at ~30s, processing backpressure is not the cause.
 *
 * Returns a disposer that stops sampling.
 */
export function startEventLoopLagMonitor(
  intervalMs = 30_000,
  thresholdP99Ms = 50,
): () => void {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();

  const log = logger.child({ component: 'event-loop-lag' });

  const timer = setInterval(() => {
    const p50Ms = histogram.percentile(50) / NS_PER_MS;
    const p99Ms = histogram.percentile(99) / NS_PER_MS;
    const maxMs = histogram.max / NS_PER_MS;

    if (p99Ms >= thresholdP99Ms) {
      log.warn(
        {
          p50Ms: Math.round(p50Ms),
          p99Ms: Math.round(p99Ms),
          maxMs: Math.round(maxMs),
          windowMs: intervalMs,
        },
        'event loop lag',
      );
    }
    histogram.reset();
  }, intervalMs);
  timer.unref();

  return () => {
    clearInterval(timer);
    histogram.disable();
  };
}
