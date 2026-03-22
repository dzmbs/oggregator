// ── Number formatters ─────────────────────────────────────────────────────
// Convention: null or zero prices render as "–" (industry standard — IB, TradingView).
// A zero bid/ask means "no market", not "free". Greeks CAN be legitimately zero
// (delta=0 for deep OTM) so they use separate formatters that preserve zero.

export function fmtUsd(v: number | null | undefined): string {
  if (v == null || v === 0) return "–";
  if (Math.abs(v) >= 1_000_000_000)
    return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(v) >= 1_000_000)
    return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)
    return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (Math.abs(v) >= 100) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}

export function fmtUsdCompact(v: number | null | undefined): string {
  if (v == null) return "–";
  if (Math.abs(v) >= 1_000_000_000)
    return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(v) >= 1_000_000)
    return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)
    return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function fmtIv(v: number | null | undefined): string {
  if (v == null || v === 0) return "–";
  return `${(v * 100).toFixed(1)}%`;
}

export function fmtPct(v: number | null | undefined, decimals = 2): string {
  if (v == null) return "–";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(decimals)}%`;
}

export function fmtDelta(v: number | null | undefined): string {
  if (v == null) return "–";
  return v.toFixed(3);
}

export function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null) return "–";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function dteDays(expiry: string): number {
  const now = Date.now();
  const exp = new Date(expiry + "T08:00:00Z").getTime();
  return Math.max(0, Math.ceil((exp - now) / 86_400_000));
}

export function formatExpiry(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate().toString().padStart(2, "0");
  const months = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  ];
  return `${day} ${months[d.getUTCMonth()]!}`;
}
