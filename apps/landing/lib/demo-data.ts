export interface TickerItem {
  label: string;
  value: string;
  change: string;
  direction: "up" | "down" | "flat";
}

export interface WorkflowStep {
  id: string;
  label: string;
  title: string;
  description: string;
  detail: string;
}

export interface FeatureCard {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  metric: string;
  supportingPoints: readonly string[];
  span: "wide" | "medium" | "compact";
}

export interface FaqItem {
  question: string;
  answer: string;
}

export const tickerItems: TickerItem[] = [
  { label: "BTC 30D IV", value: "54.2%", change: "+1.8%", direction: "up" },
  { label: "ETH 25D RR", value: "-3.6", change: "-0.4", direction: "down" },
  { label: "Latency Budget", value: "420ms", change: "stable", direction: "flat" },
  { label: "Best Venue Edge", value: "14 bps", change: "+3 bps", direction: "up" },
  { label: "Cross-Venue Depth", value: "$24.6M", change: "+2.2%", direction: "up" },
  { label: "Feed Health", value: "99.98%", change: "nominal", direction: "flat" },
];

export const terminalMetrics = [
  { label: "Refresh", value: "Sub-second", tone: "accent" },
  { label: "Venues", value: "07 connected", tone: "neutral" },
  { label: "Signals", value: "12 overlays", tone: "accent" },
] as const;

export const terminalRows = [
  {
    symbol: "BTC-27JUN26-120000-C",
    midIv: "54.2%",
    skew: "+1.4",
    venue: "Deribit",
    edge: "+14 bps",
  },
  {
    symbol: "BTC-27JUN26-110000-P",
    midIv: "57.8%",
    skew: "-3.6",
    venue: "OKX",
    edge: "+9 bps",
  },
  {
    symbol: "ETH-29AUG26-7000-C",
    midIv: "63.1%",
    skew: "+0.8",
    venue: "Binance",
    edge: "+11 bps",
  },
  {
    symbol: "SOL-31JUL26-250-C",
    midIv: "71.4%",
    skew: "+2.2",
    venue: "Bybit",
    edge: "+6 bps",
  },
] as const;

export const routeCandidates = [
  { venue: "Deribit", fill: "42%", latency: "118ms", status: "primary" },
  { venue: "OKX", fill: "31%", latency: "146ms", status: "secondary" },
  { venue: "Binance", fill: "27%", latency: "156ms", status: "secondary" },
] as const;

export const commandSequence = [
  "load btc front-week skew",
  "overlay internal-risk-signal",
  "compare deribit okx binance",
  "route best executable venue",
] as const;

export const workflowSteps: WorkflowStep[] = [
  {
    id: "ingest",
    label: "01",
    title: "Ingest",
    description:
      "Connect exchange feeds, internal pricing, and desk signals without forcing traders to leave the terminal.",
    detail: "Feeds, snapshots, and overlays stay in the same loop.",
  },
  {
    id: "normalize",
    label: "02",
    title: "Normalize",
    description:
      "Unify expiries, deltas, IV conventions, and venue context so every comparison is actually comparable.",
    detail: "No manual quote reconciliation across fragmented venues.",
  },
  {
    id: "execute",
    label: "03",
    title: "Execute",
    description:
      "Scan structure, surface edge, and route from a single workspace tuned for fast decisions under pressure.",
    detail: "The interface stays calm while the decision stack stays deep.",
  },
] as const;

export const featureCards: FeatureCard[] = [
  {
    id: "latency",
    eyebrow: "Performance",
    title: "Ultra-low latency operating model",
    description:
      "Prioritize the quotes that matter, keep feed health visible, and surface venue edge before the trade window closes.",
    metric: "420ms live budget",
    supportingPoints: ["Fast refresh loop", "Connection-state visibility"],
    span: "medium",
  },
  {
    id: "aggregation",
    eyebrow: "Aggregation",
    title: "Multi-exchange options context",
    description:
      "Compare fragmented options liquidity in one normalized frame instead of cross-checking five disconnected terminals.",
    metric: "07 venues live",
    supportingPoints: ["Venue-normalized quotes", "Cross-venue route scoring"],
    span: "wide",
  },
  {
    id: "visualization",
    eyebrow: "Visualization",
    title: "Advanced surface and skew tools",
    description:
      "Read wings, term structure, and concentration quickly with visual layers designed for desk scanning, not showreels.",
    metric: "91 delta points",
    supportingPoints: ["Vol surface views", "Skew-aware inspection"],
    span: "medium",
  },
  {
    id: "commands",
    eyebrow: "Commands",
    title: "Custom command execution",
    description:
      "Run terminal-native workflows for comparison, overlays, and route selection without context switching.",
    metric: "CLI-native actions",
    supportingPoints: ["Command palette", "Repeatable workflows"],
    span: "compact",
  },
  {
    id: "monitoring",
    eyebrow: "Reliability",
    title: "Connectivity and venue health monitoring",
    description:
      "Keep transport state, route confidence, and degradation signals visible so the tool never hides operational reality.",
    metric: "99.98% feed health",
    supportingPoints: ["Health telemetry", "Visible failover state"],
    span: "compact",
  },
  {
    id: "integration",
    eyebrow: "Integration",
    title: "Bring your own desk intelligence",
    description:
      "Merge internal marks, inventory constraints, and proprietary signals into the same decision surface.",
    metric: "12 overlay channels",
    supportingPoints: ["Internal risk inputs", "Custom enrichment hooks"],
    span: "compact",
  },
] as const;

export const capabilitySignals = [
  "Command-driven workflows",
  "Venue-level route scoring",
  "Desk-safe monitoring",
  "Internal signal overlays",
] as const;

export const faqItems: FaqItem[] = [
  {
    question: "Which exchanges and instruments does Oggregator support?",
    answer:
      "The platform is designed for multi-exchange options aggregation with venue-aware context. Final onboarding support depends on the desk setup, instrument mix, and rollout phase, but the architecture is built for fragmented crypto options markets rather than a single-venue view.",
  },
  {
    question: "How fast is the feed and routing update cycle?",
    answer:
      "The terminal is tuned for sub-second visibility with explicit latency budgeting. The goal is not just fast rendering, but fast enough normalized context for routing decisions without hiding state transitions or degraded feeds.",
  },
  {
    question: "Can we connect proprietary or internal desk signals?",
    answer:
      "Yes. Internal marks, risk overlays, and desk-specific enrichment can be merged into the same operating surface so routing logic reflects your actual stack instead of a generic market-only view.",
  },
  {
    question: "Is the terminal browser-based, desktop-native, or both?",
    answer:
      "The product direction is terminal-first and workflow-first. Delivery shape depends on deployment requirements, but the user experience is designed to feel like a serious pro tool rather than a lightweight marketing dashboard.",
  },
  {
    question: "How do connectivity failover and venue health monitoring work?",
    answer:
      "Operational state is surfaced directly in the interface: venue status, route confidence, and degradation cues are treated as first-class UI elements so traders can see when the market view changes because transport quality changed.",
  },
  {
    question: "Do you expose APIs or command hooks for automation?",
    answer:
      "The platform is designed around command-driven workflows and extensible integration points. Automation scope is shaped during onboarding so the surface can fit desk-specific routing, monitoring, and execution requirements.",
  },
] as const;

export const marketContextRows = [
  { label: "BTC 30D ATM IV", value: "54.2%", detail: "front vol +1.8%" },
  { label: "ETH 25D RR", value: "-3.6", detail: "put skew bid" },
  { label: "XRP FRONT PREM", value: "12.4%", detail: "near expiry premium" },
  { label: "BNB OPEN INTEREST", value: "$184M", detail: "cross-venue monitored" },
] as const;

export const deskSnippet = [
  "venue: 'deribit'",
  "altVenue: 'okx'",
  "bestVenueSelection: 'deribit'",
  "edgeBps: 14",
  "normalizedIv: 0.542",
] as const;

export const dataSnippet = [
  "subscribe('BTC-27JUN26-120000-C')",
  "fetch('/api/quotes?venue=okx')",
  "mergeFeed('internal-risk-signal')",
] as const;

export const testimonials = [
  {
    quote:
      "Oggregator gave us one screen for IV, skew, and routing context without the usual venue switching.",
    person: "Desk PM",
    company: "Crypto Vol Desk",
  },
  {
    quote:
      "The venue normalization is the difference. We stopped comparing mismatched quotes by hand.",
    person: "Execution Lead",
    company: "Options Market Maker",
  },
  {
    quote:
      "It feels like a serious desk product, not another retail dashboard pretending to be institutional.",
    person: "Founder",
    company: "Systematic Trading Team",
  },
] as const;

export const surfaceStats = [
  { label: "Data points", value: "91 deltas" },
  { label: "Venues", value: "7 venues" },
  { label: "Refresh", value: "sub-second" },
  { label: "Interaction", value: "interactive tenor map" },
] as const;
