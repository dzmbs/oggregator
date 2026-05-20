// ── Theme color constants ──────────────────────────────────────────────────

export const COLORS = {
  bgDeepest: '#0a0b0e',
  bgSurface: '#111318',
  bgElevated: '#181c24',
  border: 'rgba(255,255,255,0.07)',
  textPrimary: '#e8eaf0',
  textMuted: '#8b909e',
  green: '#4ade80',
  amber: '#fbbf24',
  red: '#f87171',
  blue: '#60a5fa',
  purple: '#a78bfa',
} as const;

// ── IV chip color ─────────────────────────────────────────────────────────

export type IvLevel = 'green' | 'amber' | 'red' | 'muted';

export function ivLevel(iv: number | null): IvLevel {
  if (iv == null) return 'muted';
  if (iv < 0.5) return 'green';
  if (iv < 0.65) return 'amber';
  return 'red';
}

export function ivColor(level: IvLevel): string {
  switch (level) {
    case 'green':
      return COLORS.green;
    case 'amber':
      return COLORS.amber;
    case 'red':
      return COLORS.red;
    case 'muted':
      return COLORS.textMuted;
  }
}

// ── Spread pill color ─────────────────────────────────────────────────────

export type SpreadLevel = 'green' | 'amber' | 'red';

export function spreadLevel(pct: number | null): SpreadLevel {
  if (pct == null || pct < 2.5) return 'green';
  if (pct < 4.5) return 'amber';
  return 'red';
}

// ── Forward drift semaphore ───────────────────────────────────────────────
// |Δ / atmStrike| expressed in basis points. Below 1 bps the venue's forward
// is in consensus (any price divergence reflects real MM skew). Above 3 bps
// the venue's forward is drifting and cheap/expensive option prices are
// mostly forward, not edge.

export type ForwardLevel = 'green' | 'amber' | 'red' | 'muted';

export function forwardDriftLevel(deltaBps: number | null): ForwardLevel {
  if (deltaBps == null || !Number.isFinite(deltaBps)) return 'muted';
  const m = Math.abs(deltaBps);
  if (m < 1) return 'green';
  if (m < 3) return 'amber';
  return 'red';
}

// ── Venue colors ──────────────────────────────────────────────────────────

export const VENUE_COLORS: Record<string, string> = {
  deribit: '#0052FF',
  okx: '#e8eaf0',
  binance: '#F0B90B',
  bybit: '#F7A600',
  derive: '#FF8A3D',
  coincall: '#1FE086',
  thalex: '#5DADE2',
  gateio: '#E5374E',
};

export function venueColor(venueId: string): string {
  return VENUE_COLORS[venueId] ?? '#8b909e';
}

export const VENUE_GRADIENTS: Record<string, string> = {
  derive: 'linear-gradient(135deg, #FFB347 0%, #FF6F3C 100%)',
};

export function venueGradient(venueId: string): string | null {
  return VENUE_GRADIENTS[venueId] ?? null;
}

// ── Delta-bucket color ramp ───────────────────────────────────────────────
// Cool (puts) → bright (ATM) → warm (calls). Used to color the multi-delta
// term-structure curves so OTM puts and OTM calls visually separate.

export function deltaColor(delta: number): string {
  if (Math.abs(delta - 0.5) < 1e-6) return '#FFFFFF';
  if (delta < 0.5) {
    const t = delta / 0.5;
    const hue = 210 - 30 * t;
    const light = 40 + 30 * t;
    return `hsl(${hue}, 70%, ${light}%)`;
  }
  const t = (delta - 0.5) / 0.5;
  const hue = 50 - 50 * t;
  const light = 65 - 25 * t;
  return `hsl(${hue}, 75%, ${light}%)`;
}

export function deltaLabel(delta: number): string {
  if (Math.abs(delta - 0.5) < 1e-6) return 'ATM';
  if (delta < 0.5) return `${Math.round(delta * 100)}Δ Put`;
  return `${Math.round((1 - delta) * 100)}Δ Call`;
}

// ── IV surface heatmap color ───────────────────────────────────────────────
// Maps a value in [0,1] range (normalized between min and max IV) to a color.
// 0 = green (low IV), 0.5 = amber, 1 = red (high IV)

export function heatmapColor(normalized: number): string {
  if (normalized <= 0.5) {
    // green → amber
    const t = normalized * 2;
    const r = Math.round(74 + t * (251 - 74));
    const g = Math.round(222 + t * (191 - 222));
    const b = Math.round(128 + t * (36 - 128));
    return `rgb(${r},${g},${b})`;
  } else {
    // amber → red
    const t = (normalized - 0.5) * 2;
    const r = Math.round(251 + t * (248 - 251));
    const g = Math.round(191 + t * (113 - 191));
    const b = Math.round(36 + t * (113 - 36));
    return `rgb(${r},${g},${b})`;
  }
}
