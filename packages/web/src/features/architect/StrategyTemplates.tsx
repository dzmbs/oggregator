import { useState } from "react";

import type { EnrichedChainResponse } from "@shared/enriched";
import { useStrategyStore } from "./strategy-store";
import type { Leg } from "./payoff";
import MiniPayoff, { STRATEGY_SHAPES } from "./MiniPayoff";
import styles from "./Architect.module.css";

type Sentiment = "all" | "bullish" | "bearish" | "volatile" | "neutral";

interface StrategyTemplate {
  name: string;
  sentiment: "bullish" | "bearish" | "volatile" | "neutral";
  description: string;
  build: (chain: EnrichedChainResponse, expiry: string) => Omit<Leg, "id">[];
}

function findAtmStrike(chain: EnrichedChainResponse): number {
  const ref = chain.stats.forwardPriceUsd ?? chain.stats.spotIndexUsd ?? 70000;
  let best = chain.strikes[0]?.strike ?? ref;
  let bestDist = Infinity;
  for (const s of chain.strikes) {
    const dist = Math.abs(s.strike - ref);
    if (dist < bestDist) { bestDist = dist; best = s.strike; }
  }
  return best;
}

function getBestPrice(chain: EnrichedChainResponse, strike: number, type: "call" | "put", direction: "buy" | "sell") {
  const s = chain.strikes.find((x) => x.strike === strike);
  if (!s) return null;
  const side = type === "call" ? s.call : s.put;
  let bestPrice: number | null = null;
  let bestVenueId = "";
  let bestQ: { delta: number | null; gamma: number | null; theta: number | null; vega: number | null; markIv: number | null } | null = null;

  for (const [vid, vq] of Object.entries(side.venues)) {
    if (!vq) continue;
    const p = direction === "buy" ? vq.ask : vq.bid;
    if (p == null || p <= 0) continue;
    if (bestPrice == null || (direction === "buy" && p < bestPrice) || (direction === "sell" && p > bestPrice)) {
      bestPrice = p; bestVenueId = vid; bestQ = vq;
    }
  }
  if (bestPrice == null || !bestQ) return null;
  return { price: bestPrice, venue: bestVenueId, delta: bestQ.delta, gamma: bestQ.gamma, theta: bestQ.theta, vega: bestQ.vega, iv: bestQ.markIv };
}

function ml(p: NonNullable<ReturnType<typeof getBestPrice>>, base: Omit<Leg, "id" | "entryPrice" | "venue" | "delta" | "gamma" | "theta" | "vega" | "iv">): Omit<Leg, "id"> {
  return { ...base, entryPrice: p.price, venue: p.venue, delta: p.delta, gamma: p.gamma, theta: p.theta, vega: p.vega, iv: p.iv };
}

function off(chain: EnrichedChainResponse, atm: number, n: number): number {
  const sorted = chain.strikes.map((s) => s.strike).sort((a, b) => a - b);
  const idx = sorted.indexOf(atm);
  if (idx < 0) return atm;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx + n))]!;
}

export const TEMPLATES: StrategyTemplate[] = [
  { name: "Long Call", sentiment: "bullish", description: "Unlimited upside, limited risk",
    build: (c, e) => { const a = findAtmStrike(c); const p = getBestPrice(c, a, "call", "buy"); return p ? [ml(p, { type: "call", direction: "buy", strike: a, expiry: e, quantity: 1 })] : []; } },
  { name: "Long Put", sentiment: "bearish", description: "Profit from price drops",
    build: (c, e) => { const a = findAtmStrike(c); const p = getBestPrice(c, a, "put", "buy"); return p ? [ml(p, { type: "put", direction: "buy", strike: a, expiry: e, quantity: 1 })] : []; } },
  { name: "Short Call", sentiment: "bearish", description: "Collect premium, bearish bias",
    build: (c, e) => { const a = findAtmStrike(c); const p = getBestPrice(c, a, "call", "sell"); return p ? [ml(p, { type: "call", direction: "sell", strike: a, expiry: e, quantity: 1 })] : []; } },
  { name: "Short Put", sentiment: "bullish", description: "Collect premium, bullish bias",
    build: (c, e) => { const a = findAtmStrike(c); const p = getBestPrice(c, a, "put", "sell"); return p ? [ml(p, { type: "put", direction: "sell", strike: a, expiry: e, quantity: 1 })] : []; } },
  { name: "Bull Call Spread", sentiment: "bullish", description: "Defined risk bullish",
    build: (c, e) => { const a = findAtmStrike(c); const o = off(c, a, 3); const b = getBestPrice(c, a, "call", "buy"); const s = getBestPrice(c, o, "call", "sell");
      const legs: Omit<Leg, "id">[] = []; if (b) legs.push(ml(b, { type: "call", direction: "buy", strike: a, expiry: e, quantity: 1 })); if (s) legs.push(ml(s, { type: "call", direction: "sell", strike: o, expiry: e, quantity: 1 })); return legs; } },
  { name: "Bear Put Spread", sentiment: "bearish", description: "Defined risk bearish",
    build: (c, e) => { const a = findAtmStrike(c); const o = off(c, a, -3); const b = getBestPrice(c, a, "put", "buy"); const s = getBestPrice(c, o, "put", "sell");
      const legs: Omit<Leg, "id">[] = []; if (b) legs.push(ml(b, { type: "put", direction: "buy", strike: a, expiry: e, quantity: 1 })); if (s) legs.push(ml(s, { type: "put", direction: "sell", strike: o, expiry: e, quantity: 1 })); return legs; } },
  { name: "Long Straddle", sentiment: "volatile", description: "Profit from big moves",
    build: (c, e) => { const a = findAtmStrike(c); const legs: Omit<Leg, "id">[] = []; const ca = getBestPrice(c, a, "call", "buy"); const pu = getBestPrice(c, a, "put", "buy");
      if (ca) legs.push(ml(ca, { type: "call", direction: "buy", strike: a, expiry: e, quantity: 1 })); if (pu) legs.push(ml(pu, { type: "put", direction: "buy", strike: a, expiry: e, quantity: 1 })); return legs; } },
  { name: "Long Strangle", sentiment: "volatile", description: "Cheaper than straddle",
    build: (c, e) => { const a = findAtmStrike(c); const oc = off(c, a, 3); const op = off(c, a, -3); const legs: Omit<Leg, "id">[] = [];
      const ca = getBestPrice(c, oc, "call", "buy"); const pu = getBestPrice(c, op, "put", "buy");
      if (ca) legs.push(ml(ca, { type: "call", direction: "buy", strike: oc, expiry: e, quantity: 1 })); if (pu) legs.push(ml(pu, { type: "put", direction: "buy", strike: op, expiry: e, quantity: 1 })); return legs; } },
  { name: "Iron Condor", sentiment: "neutral", description: "Profit from low volatility",
    build: (c, e) => { const a = findAtmStrike(c); const sp = off(c, a, -2); const bp = off(c, a, -4); const sc = off(c, a, 2); const bc = off(c, a, 4);
      const legs: Omit<Leg, "id">[] = [];
      const _bp = getBestPrice(c, bp, "put", "buy"); const _sp = getBestPrice(c, sp, "put", "sell"); const _sc = getBestPrice(c, sc, "call", "sell"); const _bc = getBestPrice(c, bc, "call", "buy");
      if (_bp) legs.push(ml(_bp, { type: "put", direction: "buy", strike: bp, expiry: e, quantity: 1 })); if (_sp) legs.push(ml(_sp, { type: "put", direction: "sell", strike: sp, expiry: e, quantity: 1 }));
      if (_sc) legs.push(ml(_sc, { type: "call", direction: "sell", strike: sc, expiry: e, quantity: 1 })); if (_bc) legs.push(ml(_bc, { type: "call", direction: "buy", strike: bc, expiry: e, quantity: 1 })); return legs; } },
  { name: "Call Butterfly", sentiment: "neutral", description: "Profit near ATM strike",
    build: (c, e) => { const a = findAtmStrike(c); const lo = off(c, a, -2); const up = off(c, a, 2);
      const legs: Omit<Leg, "id">[] = []; const bl = getBestPrice(c, lo, "call", "buy"); const sm = getBestPrice(c, a, "call", "sell"); const bu = getBestPrice(c, up, "call", "buy");
      if (bl) legs.push(ml(bl, { type: "call", direction: "buy", strike: lo, expiry: e, quantity: 1 })); if (sm) legs.push(ml(sm, { type: "call", direction: "sell", strike: a, expiry: e, quantity: 2 }));
      if (bu) legs.push(ml(bu, { type: "call", direction: "buy", strike: up, expiry: e, quantity: 1 })); return legs; } },
];

const SENTIMENTS: Array<{ id: Sentiment; label: string }> = [
  { id: "all", label: "All" },
  { id: "bullish", label: "Bullish" },
  { id: "bearish", label: "Bearish" },
  { id: "volatile", label: "Volatile" },
  { id: "neutral", label: "Neutral" },
];

interface Props {
  chain: EnrichedChainResponse | null;
  expiry: string;
  underlying: string;
}

export default function StrategyTemplates({ chain, expiry, underlying }: Props) {
  const addLeg = useStrategyStore((s) => s.addLeg);
  const clearLegs = useStrategyStore((s) => s.clearLegs);
  const [sentiment, setSentiment] = useState<Sentiment>("all");
  const [error, setError] = useState<string | null>(null);

  if (!chain) return null;

  const filtered = sentiment === "all" ? TEMPLATES : TEMPLATES.filter((t) => t.sentiment === sentiment);

  // Expected leg counts for validation
  const EXPECTED_LEGS: Record<string, number> = {
    "Long Call": 1, "Long Put": 1, "Short Call": 1, "Short Put": 1,
    "Bull Call Spread": 2, "Bear Put Spread": 2,
    "Long Straddle": 2, "Long Strangle": 2,
    "Iron Condor": 4, "Call Butterfly": 3,
  };

  function handleApply(template: StrategyTemplate) {
    if (!chain) return;
    setError(null);
    const newLegs = template.build(chain, expiry);
    const expected = EXPECTED_LEGS[template.name] ?? 1;
    if (newLegs.length === 0) {
      setError(`No quotes available for ${template.name} on this expiry. Try a later date.`);
      return;
    }
    if (newLegs.length < expected) {
      setError(`${template.name} needs ${expected} legs but only ${newLegs.length} had quotes. Some strikes may be illiquid — try a later expiry.`);
      return;
    }
    clearLegs();
    for (const leg of newLegs) addLeg(leg, underlying);
  }

  return (
    <div className={styles.templatesSection}>
      <div className={styles.sentimentBar}>
        {SENTIMENTS.map((s) => (
          <button
            key={s.id}
            className={styles.sentimentBtn}
            data-active={s.id === sentiment}
            data-sentiment={s.id}
            onClick={() => setSentiment(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className={styles.templateGrid}>
        {filtered.map((t) => (
          <button
            key={t.name}
            className={styles.templateCard}
            data-sentiment={t.sentiment}
            onClick={() => handleApply(t)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", t.name);
              e.dataTransfer.effectAllowed = "copy";
            }}
          >
            <MiniPayoff shape={STRATEGY_SHAPES[t.name] ?? [[0, 0], [1, 0]]} width={140} height={56} />
            <span className={styles.templateCardName}>{t.name}</span>
            <span className={styles.templateCardDesc}>{t.description}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className={styles.templateError}>
          {error}
          <button className={styles.templateErrorClose} onClick={() => setError(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
