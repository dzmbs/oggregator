export interface TickerItem {
  label: string;
  value: string;
  change: string;
  direction: 'up' | 'down' | 'flat';
}

export interface WorkflowStep {
  id: string;
  label: string;
  title: string;
  description: string;
  detail: string;
}

export interface SpatialMode {
  id: string;
  title: string;
  description: string;
  signal: string;
  emphasis: string;
}

export interface SpatialOverlayRule {
  id: string;
  title: string;
  description: string;
  detail: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export const tickerItems: TickerItem[] = [
  { label: 'BTC 30D IV', value: '54.2%', change: '+1.8%', direction: 'up' },
  { label: 'ETH 25D RR', value: '-3.6', change: '-0.4', direction: 'down' },
  { label: 'Latency Budget', value: '420ms', change: 'stable', direction: 'flat' },
  { label: 'Best Venue Edge', value: '14 bps', change: '+3 bps', direction: 'up' },
  { label: 'Cross-Venue Depth', value: '$24.6M', change: '+2.2%', direction: 'up' },
  { label: 'Feed Health', value: '99.98%', change: 'nominal', direction: 'flat' },
];

export const terminalMetrics = [
  { label: 'Refresh', value: 'Sub-second', tone: 'accent' },
  { label: 'Venues', value: '07 connected', tone: 'neutral' },
  { label: 'Signals', value: '12 overlays', tone: 'accent' },
] as const;

export const terminalRows = [
  {
    symbol: 'BTC-27JUN26-120000-C',
    midIv: '54.2%',
    skew: '+1.4',
    venue: 'Deribit',
    edge: '+14 bps',
  },
  {
    symbol: 'BTC-27JUN26-110000-P',
    midIv: '57.8%',
    skew: '-3.6',
    venue: 'OKX',
    edge: '+9 bps',
  },
  {
    symbol: 'ETH-29AUG26-7000-C',
    midIv: '63.1%',
    skew: '+0.8',
    venue: 'Binance',
    edge: '+11 bps',
  },
  {
    symbol: 'SOL-31JUL26-250-C',
    midIv: '71.4%',
    skew: '+2.2',
    venue: 'Bybit',
    edge: '+6 bps',
  },
] as const;

export const routeCandidates = [
  { venue: 'Deribit', fill: '42%', latency: '118ms', status: 'primary' },
  { venue: 'OKX', fill: '31%', latency: '146ms', status: 'secondary' },
  { venue: 'Binance', fill: '27%', latency: '156ms', status: 'secondary' },
] as const;

export const commandSequence = [
  'load btc front-week skew',
  'overlay internal-risk-signal',
  'compare deribit okx binance',
  'route best executable venue',
] as const;

export const workflowSteps: WorkflowStep[] = [
  {
    id: 'overview',
    label: '01',
    title: 'Overview',
    description:
      'Start with the full surface silhouette so regime shifts, event humps, and wing pressure read before any local telemetry competes for attention.',
    detail:
      'Camera stays wide. Labels stay quiet. Ghost baseline and major overlays remain visible.',
  },
  {
    id: 'regional',
    label: '02',
    title: 'Regional focus',
    description:
      'Move toward a tenor corridor or skew ridge to reveal cross-sections, venue divergence, and confidence weighting only where the eye is already looking.',
    detail: 'Proximity brings out local contours, route ribbons, and clustered coordinate labels.',
  },
  {
    id: 'point',
    label: '03',
    title: 'Point detail',
    description:
      'Lock a strike and expiry node to inspect exact IV, spread, liquidity, and confidence from an anchored tooltip instead of opening a separate detail card.',
    detail: 'The camera dive ends with coordinate-bound telemetry and execution-grade precision.',
  },
] as const;

export const spatialModes: SpatialMode[] = [
  {
    id: 'surface',
    title: 'Surface mode',
    description:
      'Keep the whole smile and term topology in view so event humps, wing pressure, and curvature shifts read at a glance.',
    signal: 'Whole-book regime',
    emphasis: 'Shape first, labels suppressed until approach',
  },
  {
    id: 'skew',
    title: 'Skew mode',
    description:
      'Promote downside versus upside asymmetry with directional lighting, ridge callouts, and local slope telemetry.',
    signal: 'Wing stress',
    emphasis: 'Downside curvature and smile imbalance',
  },
  {
    id: 'term',
    title: 'Term mode',
    description:
      'Snap the camera toward tenor corridors and reveal cross-sections only where expiry structure matters.',
    signal: 'Tenor migration',
    emphasis: 'Expiry ridges, humps, and event shelves',
  },
  {
    id: 'liquidity',
    title: 'Liquidity mode',
    description:
      'Fade absolute IV noise and elevate quote quality, venue spread ribbons, and executable depth near the focus cone.',
    signal: 'Execution quality',
    emphasis: 'Depth and route confidence near the active node',
  },
] as const;

export const spatialOverlayRules: SpatialOverlayRule[] = [
  {
    id: 'proximity',
    title: 'Progressive disclosure by proximity',
    description:
      'Labels and telemetry bloom only inside the active focus cone so the macro surface stays readable from a distance.',
    detail: 'Far field shows topology, near field shows tradeable precision.',
  },
  {
    id: 'tooltips',
    title: 'Tooltips anchored to 3D coordinates',
    description:
      'Context panels attach to the selected strike and expiry node instead of floating as detached cards.',
    detail: 'Pinned markers collapse when they compete for the same screen space.',
  },
  {
    id: 'overlays',
    title: 'Volumetric overlays with a hard budget',
    description:
      'Use one primary overlay and one secondary overlay at most: liquidity fog, venue spread ribbons, or confidence mesh.',
    detail: 'Opacity and motion encode confidence and recency without drowning the surface.',
  },
  {
    id: 'transitions',
    title: 'Macro-to-micro camera transitions',
    description:
      'Orbit for regime awareness, wheel into regional focus, then lock a node for exact quotes and Greeks.',
    detail:
      'No page change, only a camera dive with local rails and telemetry assembling in place.',
  },
] as const;

export const faqItems: FaqItem[] = [
  {
    question: 'Which exchanges and instruments does Oggregator support?',
    answer:
      'The platform is designed for multi-exchange options aggregation with venue-aware context. Final onboarding support depends on the desk setup, instrument mix, and rollout phase, but the architecture is built for fragmented crypto options markets rather than a single-venue view.',
  },
  {
    question: 'How fast is the feed and routing update cycle?',
    answer:
      'The terminal is tuned for sub-second visibility with explicit latency budgeting. The goal is not just fast rendering, but fast enough normalized context for routing decisions without hiding state transitions or degraded feeds.',
  },
  {
    question: 'Can we connect proprietary or internal desk signals?',
    answer:
      'Yes. Internal marks, risk overlays, and desk-specific enrichment can be merged into the same operating surface so routing logic reflects your actual stack instead of a generic market-only view.',
  },
  {
    question: 'Is the terminal browser-based, desktop-native, or both?',
    answer:
      'The product direction is terminal-first and workflow-first. Delivery shape depends on deployment requirements, but the user experience is designed to feel like a serious pro tool rather than a lightweight marketing dashboard.',
  },
  {
    question: 'How do connectivity failover and venue health monitoring work?',
    answer:
      'Operational state is surfaced directly in the interface: venue status, route confidence, and degradation cues are treated as first-class UI elements so traders can see when the market view changes because transport quality changed.',
  },
  {
    question: 'Do you expose APIs or command hooks for automation?',
    answer:
      'The platform is designed around command-driven workflows and extensible integration points. Automation scope is shaped during onboarding so the surface can fit desk-specific routing, monitoring, and execution requirements.',
  },
] as const;

export const marketContextRows = [
  { label: 'BTC 30D ATM IV', value: '54.2%', detail: 'front vol +1.8%' },
  { label: 'ETH 25D RR', value: '-3.6', detail: 'put skew bid' },
  { label: 'XRP FRONT PREM', value: '12.4%', detail: 'near expiry premium' },
  { label: 'BNB OPEN INTEREST', value: '$184M', detail: 'cross-venue monitored' },
] as const;

export const deskSnippet = [
  "venue: 'deribit'",
  "altVenue: 'okx'",
  "bestVenueSelection: 'deribit'",
  'edgeBps: 14',
  'normalizedIv: 0.542',
] as const;

export const dataSnippet = [
  "subscribe('BTC-27JUN26-120000-C')",
  "fetch('/api/quotes?venue=okx')",
  "mergeFeed('internal-risk-signal')",
] as const;

export const testimonials = [
  {
    quote:
      'Oggregator gave us one screen for IV, skew, and routing context without the usual venue switching.',
    person: 'Desk PM',
    company: 'Crypto Vol Desk',
  },
  {
    quote:
      'The venue normalization is the difference. We stopped comparing mismatched quotes by hand.',
    person: 'Execution Lead',
    company: 'Options Market Maker',
  },
  {
    quote:
      'It feels like a serious desk product, not another retail dashboard pretending to be institutional.',
    person: 'Founder',
    company: 'Systematic Trading Team',
  },
] as const;

export const surfaceStats = [
  { label: 'Data points', value: '91 deltas' },
  { label: 'Venues', value: '7 venues' },
  { label: 'Refresh', value: 'sub-second' },
  { label: 'Interaction', value: 'interactive tenor map' },
] as const;
