import type { Leg } from "./payoff";

/** Encode legs into a compact URL-safe string. */
export function encodeStrategy(legs: Leg[], underlying: string): string {
  if (legs.length === 0) return "";
  const data = {
    u: underlying,
    l: legs.map((leg) => ({
      d: leg.direction === "buy" ? "b" : "s",
      t: leg.type === "call" ? "c" : "p",
      k: leg.strike,
      e: leg.expiry,
      q: leg.quantity,
      p: Math.round(leg.entryPrice * 100) / 100,
      v: leg.venue,
    })),
  };
  return btoa(JSON.stringify(data));
}

/** Decode legs from a URL param string. Returns null if invalid. */
export function decodeStrategy(encoded: string): { underlying: string; legs: Omit<Leg, "id">[] } | null {
  try {
    const data = JSON.parse(atob(encoded));
    if (!data?.u || !Array.isArray(data.l)) return null;
    const legs: Omit<Leg, "id">[] = data.l.map((l: Record<string, unknown>) => ({
      direction: l.d === "b" ? "buy" as const : "sell" as const,
      type: l.t === "c" ? "call" as const : "put" as const,
      strike: Number(l.k),
      expiry: String(l.e),
      quantity: Number(l.q) || 1,
      entryPrice: Number(l.p),
      venue: String(l.v || ""),
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      iv: null,
    }));
    return { underlying: data.u, legs };
  } catch {
    return null;
  }
}

/** Build shareable URL with encoded strategy. */
export function buildShareUrl(legs: Leg[], underlying: string): string {
  const encoded = encodeStrategy(legs, underlying);
  if (!encoded) return window.location.href;
  const url = new URL(window.location.href);
  url.searchParams.set("strategy", encoded);
  return url.toString();
}
