/** Exponential backoff with jitter to prevent thundering-herd reconnects. */
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 30_000): number {
  return Math.min(baseMs * 2 ** attempt + Math.random() * 200, maxMs);
}

/** Deribit allows ~3.3 subscribe calls/sec (30k credit pool, 3k per call). */
