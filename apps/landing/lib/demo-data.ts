export interface TickerItem {
  label: string;
  value: string;
  change: string;
  direction: "up" | "down" | "flat";
}

export const tickerItems: TickerItem[] = [
  { label: "BTC 30D IV", value: "54.2%", change: "+1.8%", direction: "up" },
  { label: "ETH 25D RR", value: "-3.6", change: "-0.4", direction: "down" },
  { label: "XRP ATM IV", value: "71.4%", change: "+0.9%", direction: "up" },
  { label: "BNB OI", value: "$184M", change: "+2.2%", direction: "up" },
  { label: "BTC/ETH Spread", value: "12 bps", change: "-2 bps", direction: "down" },
  { label: "Cross-Venue Depth", value: "$24.6M", change: "flat", direction: "flat" },
];

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
