import { useMemo, useState } from 'react';

import { formatExpiry } from '@lib/format';
import type { EnrichedChainResponse } from '@shared/enriched';
import type { Leg } from './payoff';
import MiniPayoff, { STRATEGY_SHAPES } from './MiniPayoff';
import { useStrategyStore } from './strategy-store';
import styles from './Architect.module.css';

type Sentiment = 'bullish' | 'bearish' | 'volatile' | 'neutral';
type Category = 'all' | 'directional' | 'volatility' | 'income';
type VariantId = 'buy' | 'sell';

type BuiltLeg = Omit<Leg, 'id'>;

interface LegSpec {
  type: 'call' | 'put';
  direction: 'buy' | 'sell';
  strike: number;
  quantity: number;
}

interface LegAttempt {
  spec: LegSpec;
  built: BuiltLeg | null;
}

interface StrategyVariant {
  id: VariantId;
  label: string;
  helper: string;
  shape: keyof typeof STRATEGY_SHAPES;
  sentiment: Sentiment;
  build: (chain: EnrichedChainResponse, expiry: string) => LegAttempt[];
}

interface StrategyTemplate {
  id: string;
  name: string;
  category: Category;
  legs: number;
  variants: readonly [StrategyVariant, StrategyVariant];
}

export interface TemplateBuildFailure {
  message: string;
}

export type TemplateBuildResult =
  | { ok: true; legs: BuiltLeg[] }
  | { ok: false; error: TemplateBuildFailure };

function findAtmStrike(chain: EnrichedChainResponse): number {
  // Use the server-provided ATM if present; otherwise match the rest of the
  // Architect view (forward first, then index) to keep build/chart aligned.
  if (chain.stats.atmStrike != null) return chain.stats.atmStrike;
  const ref = chain.stats.forwardPriceUsd ?? chain.stats.indexPriceUsd ?? 70000;
  let best = chain.strikes[0]?.strike ?? ref;
  let bestDist = Infinity;

  for (const strike of chain.strikes) {
    const dist = Math.abs(strike.strike - ref);
    if (dist < bestDist) {
      bestDist = dist;
      best = strike.strike;
    }
  }

  return best;
}

function getBestPrice(
  chain: EnrichedChainResponse,
  strike: number,
  type: 'call' | 'put',
  direction: 'buy' | 'sell',
) {
  const strikeRow = chain.strikes.find((entry) => entry.strike === strike);
  if (!strikeRow) return null;

  const side = type === 'call' ? strikeRow.call : strikeRow.put;
  let bestPrice: number | null = null;
  let bestVenueId = '';
  let bestQuote: {
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
    markIv: number | null;
  } | null = null;

  for (const [venueId, quote] of Object.entries(side.venues)) {
    if (!quote) continue;
    const price = direction === 'buy' ? quote.ask : quote.bid;
    if (price == null || price <= 0) continue;

    if (
      bestPrice == null ||
      (direction === 'buy' && price < bestPrice) ||
      (direction === 'sell' && price > bestPrice)
    ) {
      bestPrice = price;
      bestVenueId = venueId;
      bestQuote = quote;
    }
  }

  if (bestPrice == null || !bestQuote) return null;

  return {
    price: bestPrice,
    venue: bestVenueId,
    delta: bestQuote.delta,
    gamma: bestQuote.gamma,
    theta: bestQuote.theta,
    vega: bestQuote.vega,
    iv: bestQuote.markIv,
  };
}

function withMarket(
  price: NonNullable<ReturnType<typeof getBestPrice>>,
  base: Omit<BuiltLeg, 'entryPrice' | 'venue' | 'delta' | 'gamma' | 'theta' | 'vega' | 'iv'>,
): BuiltLeg {
  return {
    ...base,
    entryPrice: price.price,
    venue: price.venue,
    delta: price.delta,
    gamma: price.gamma,
    theta: price.theta,
    vega: price.vega,
    iv: price.iv,
  };
}

function offsetStrike(
  chain: EnrichedChainResponse,
  atm: number,
  offset: number,
): number | null {
  const sorted = chain.strikes.map((entry) => entry.strike).sort((a, b) => a - b);
  const idx = sorted.indexOf(atm);
  if (idx < 0) return null;
  return sorted[idx + offset] ?? null;
}

function tryBuildLeg(
  chain: EnrichedChainResponse,
  expiry: string,
  spec: LegSpec,
): LegAttempt {
  const price = getBestPrice(chain, spec.strike, spec.type, spec.direction);
  if (!price) return { spec, built: null };
  return {
    spec,
    built: withMarket(price, {
      type: spec.type,
      direction: spec.direction,
      strike: spec.strike,
      expiry,
      quantity: spec.quantity,
    }),
  };
}

function materialize(
  chain: EnrichedChainResponse,
  expiry: string,
  specs: LegSpec[] | null,
): LegAttempt[] {
  if (specs == null) return [];
  return specs.map((spec) => tryBuildLeg(chain, expiry, spec));
}

// Spec builders return null when any required strike is out of chain bounds —
// callers map that to a "wider strike coverage" message.

function singleLegSpecs(atm: number, type: 'call' | 'put', direction: 'buy' | 'sell'): LegSpec[] {
  return [{ type, direction, strike: atm, quantity: 1 }];
}

function verticalSpreadSpecs(
  chain: EnrichedChainResponse,
  type: 'call' | 'put',
  direction: 'buy' | 'sell',
): LegSpec[] | null {
  const atm = findAtmStrike(chain);
  const offset = type === 'call' ? 3 : -3;
  const otherStrike = offsetStrike(chain, atm, offset);
  if (otherStrike == null) return null;
  // Debit spread: buy near-ATM, sell further OTM. Credit spread inverts.
  const nearDirection: 'buy' | 'sell' = direction === 'buy' ? 'buy' : 'sell';
  const farDirection: 'buy' | 'sell' = direction === 'buy' ? 'sell' : 'buy';
  return [
    { type, direction: nearDirection, strike: atm, quantity: 1 },
    { type, direction: farDirection, strike: otherStrike, quantity: 1 },
  ];
}

function straddleSpecs(chain: EnrichedChainResponse, direction: 'buy' | 'sell'): LegSpec[] {
  const atm = findAtmStrike(chain);
  return [
    { type: 'call', direction, strike: atm, quantity: 1 },
    { type: 'put', direction, strike: atm, quantity: 1 },
  ];
}

function strangleSpecs(
  chain: EnrichedChainResponse,
  direction: 'buy' | 'sell',
): LegSpec[] | null {
  const atm = findAtmStrike(chain);
  const callStrike = offsetStrike(chain, atm, 3);
  const putStrike = offsetStrike(chain, atm, -3);
  if (callStrike == null || putStrike == null) return null;
  return [
    { type: 'call', direction, strike: callStrike, quantity: 1 },
    { type: 'put', direction, strike: putStrike, quantity: 1 },
  ];
}

function ironCondorSpecs(
  chain: EnrichedChainResponse,
  direction: 'buy' | 'sell',
): LegSpec[] | null {
  const atm = findAtmStrike(chain);
  const longPut = offsetStrike(chain, atm, -4);
  const shortPut = offsetStrike(chain, atm, -2);
  const shortCall = offsetStrike(chain, atm, 2);
  const longCall = offsetStrike(chain, atm, 4);
  if (longPut == null || shortPut == null || shortCall == null || longCall == null) return null;
  const isShort = direction === 'sell';
  // Short condor: buy outer wings (protection), sell inner. Reverse inverts.
  return [
    { type: 'put', direction: isShort ? 'buy' : 'sell', strike: longPut, quantity: 1 },
    { type: 'put', direction: isShort ? 'sell' : 'buy', strike: shortPut, quantity: 1 },
    { type: 'call', direction: isShort ? 'sell' : 'buy', strike: shortCall, quantity: 1 },
    { type: 'call', direction: isShort ? 'buy' : 'sell', strike: longCall, quantity: 1 },
  ];
}

function butterflySpecs(
  chain: EnrichedChainResponse,
  direction: 'buy' | 'sell',
): LegSpec[] | null {
  const atm = findAtmStrike(chain);
  const lower = offsetStrike(chain, atm, -2);
  const upper = offsetStrike(chain, atm, 2);
  if (lower == null || upper == null) return null;
  const outer: 'buy' | 'sell' = direction;
  const body: 'buy' | 'sell' = direction === 'buy' ? 'sell' : 'buy';
  return [
    { type: 'call', direction: outer, strike: lower, quantity: 1 },
    { type: 'call', direction: body, strike: atm, quantity: 2 },
    { type: 'call', direction: outer, strike: upper, quantity: 1 },
  ];
}

function describeMissingLeg(spec: LegSpec): string {
  const sideWord = spec.direction === 'buy' ? 'ask' : 'bid';
  const verb = spec.direction === 'buy' ? 'buy' : 'sell';
  return `${verb} ${spec.type} ${spec.strike.toLocaleString()} (no live ${sideWord})`;
}

function formatTemplateBuildError(
  template: StrategyTemplate,
  expiry: string,
  attempts: LegAttempt[],
): string {
  const formattedExpiry = expiry ? formatExpiry(expiry) : 'this expiry';
  const missing = attempts.filter((entry) => entry.built == null);

  if (missing.length === 0) {
    return `${template.name} could not be built on ${formattedExpiry}.`;
  }

  const detail = missing.map((entry) => describeMissingLeg(entry.spec)).join('; ');
  return `${template.name} on ${formattedExpiry}: ${detail}.`;
}

function emptyChainError(expiry: string): string {
  return `No strikes are available for ${formatExpiry(expiry)} yet.`;
}

function strikeCoverageError(template: StrategyTemplate, expiry: string): string {
  const formattedExpiry = expiry ? formatExpiry(expiry) : 'this expiry';
  return `${template.name} needs wider strike coverage than ${formattedExpiry} currently has. Try a later expiry.`;
}

export const TEMPLATE_CARDS: StrategyTemplate[] = [
  {
    id: 'call',
    name: 'Call',
    category: 'directional',
    legs: 1,
    variants: [
      {
        id: 'buy',
        label: 'Buy',
        helper: 'Long call',
        shape: 'Long Call',
        sentiment: 'bullish',
        build: (chain, expiry) =>
          materialize(chain, expiry, singleLegSpecs(findAtmStrike(chain), 'call', 'buy')),
      },
      {
        id: 'sell',
        label: 'Sell',
        helper: 'Short call',
        shape: 'Short Call',
        sentiment: 'bearish',
        build: (chain, expiry) =>
          materialize(chain, expiry, singleLegSpecs(findAtmStrike(chain), 'call', 'sell')),
      },
    ],
  },
  {
    id: 'put',
    name: 'Put',
    category: 'directional',
    legs: 1,
    variants: [
      {
        id: 'buy',
        label: 'Buy',
        helper: 'Long put',
        shape: 'Long Put',
        sentiment: 'bearish',
        build: (chain, expiry) =>
          materialize(chain, expiry, singleLegSpecs(findAtmStrike(chain), 'put', 'buy')),
      },
      {
        id: 'sell',
        label: 'Sell',
        helper: 'Short put',
        shape: 'Short Put',
        sentiment: 'bullish',
        build: (chain, expiry) =>
          materialize(chain, expiry, singleLegSpecs(findAtmStrike(chain), 'put', 'sell')),
      },
    ],
  },
  {
    id: 'call-spread',
    name: 'Call Spread',
    category: 'directional',
    legs: 2,
    variants: [
      {
        id: 'buy',
        label: 'Buy',
        helper: 'Call debit spread',
        shape: 'Call Debit Spread',
        sentiment: 'bullish',
        build: (chain, expiry) =>
          materialize(chain, expiry, verticalSpreadSpecs(chain, 'call', 'buy')),
      },
      {
        id: 'sell',
        label: 'Sell',
        helper: 'Call credit spread',
        shape: 'Call Credit Spread',
        sentiment: 'bearish',
        build: (chain, expiry) =>
          materialize(chain, expiry, verticalSpreadSpecs(chain, 'call', 'sell')),
      },
    ],
  },
  {
    id: 'put-spread',
    name: 'Put Spread',
    category: 'directional',
    legs: 2,
    variants: [
      {
        id: 'buy',
        label: 'Buy',
        helper: 'Put debit spread',
        shape: 'Put Debit Spread',
        sentiment: 'bearish',
        build: (chain, expiry) =>
          materialize(chain, expiry, verticalSpreadSpecs(chain, 'put', 'buy')),
      },
      {
        id: 'sell',
        label: 'Sell',
        helper: 'Put credit spread',
        shape: 'Put Credit Spread',
        sentiment: 'bullish',
        build: (chain, expiry) =>
          materialize(chain, expiry, verticalSpreadSpecs(chain, 'put', 'sell')),
      },
    ],
  },
  {
    id: 'straddle',
    name: 'Straddle',
    category: 'volatility',
    legs: 2,
    variants: [
      {
        id: 'buy',
        label: 'Buy',
        helper: 'Long straddle',
        shape: 'Long Straddle',
        sentiment: 'volatile',
        build: (chain, expiry) => materialize(chain, expiry, straddleSpecs(chain, 'buy')),
      },
      {
        id: 'sell',
        label: 'Sell',
        helper: 'Short straddle',
        shape: 'Short Straddle',
        sentiment: 'neutral',
        build: (chain, expiry) => materialize(chain, expiry, straddleSpecs(chain, 'sell')),
      },
    ],
  },
  {
    id: 'strangle',
    name: 'Strangle',
    category: 'volatility',
    legs: 2,
    variants: [
      {
        id: 'buy',
        label: 'Buy',
        helper: 'Long strangle',
        shape: 'Long Strangle',
        sentiment: 'volatile',
        build: (chain, expiry) => materialize(chain, expiry, strangleSpecs(chain, 'buy')),
      },
      {
        id: 'sell',
        label: 'Sell',
        helper: 'Short strangle',
        shape: 'Short Strangle',
        sentiment: 'neutral',
        build: (chain, expiry) => materialize(chain, expiry, strangleSpecs(chain, 'sell')),
      },
    ],
  },
  {
    id: 'iron-condor',
    name: 'Iron Condor',
    category: 'income',
    legs: 4,
    variants: [
      {
        id: 'sell',
        label: 'Sell',
        helper: 'Credit iron condor',
        shape: 'Iron Condor',
        sentiment: 'neutral',
        build: (chain, expiry) => materialize(chain, expiry, ironCondorSpecs(chain, 'sell')),
      },
      {
        id: 'buy',
        label: 'Buy',
        helper: 'Reverse iron condor',
        shape: 'Reverse Iron Condor',
        sentiment: 'volatile',
        build: (chain, expiry) => materialize(chain, expiry, ironCondorSpecs(chain, 'buy')),
      },
    ],
  },
  {
    id: 'butterfly',
    name: 'Butterfly',
    category: 'income',
    legs: 3,
    variants: [
      {
        id: 'buy',
        label: 'Buy',
        helper: 'Long butterfly',
        shape: 'Butterfly',
        sentiment: 'neutral',
        build: (chain, expiry) => materialize(chain, expiry, butterflySpecs(chain, 'buy')),
      },
      {
        id: 'sell',
        label: 'Sell',
        helper: 'Short butterfly',
        shape: 'Short Butterfly',
        sentiment: 'volatile',
        build: (chain, expiry) => materialize(chain, expiry, butterflySpecs(chain, 'sell')),
      },
    ],
  },
];

const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'directional', label: 'Directional' },
  { id: 'volatility', label: 'Volatility' },
  { id: 'income', label: 'Income' },
];

const DEFAULT_VARIANTS: Record<string, VariantId> = {
  call: 'buy',
  put: 'buy',
  'call-spread': 'buy',
  'put-spread': 'buy',
  straddle: 'buy',
  strangle: 'buy',
  'iron-condor': 'sell',
  butterfly: 'buy',
};

let activeDragId = '';

function makeDragId(templateId: string, variantId: VariantId): string {
  return `${templateId}:${variantId}`;
}

export function clearActiveTemplateDrag(): void {
  activeDragId = '';
}

export function findTemplateVariant(dragId: string) {
  const resolvedDragId = dragId || activeDragId;
  const [templateId, variantId] = resolvedDragId.split(':') as [
    string | undefined,
    VariantId | undefined,
  ];
  if (!templateId || !variantId) return null;

  const template = TEMPLATE_CARDS.find((entry) => entry.id === templateId);
  if (!template) return null;

  const variant = template.variants.find((entry) => entry.id === variantId);
  if (!variant) return null;

  return { template, variant };
}

export function buildTemplateVariant(
  chain: EnrichedChainResponse | null,
  expiry: string,
  template: StrategyTemplate,
  variant: StrategyVariant,
): TemplateBuildResult {
  if (!chain) {
    return {
      ok: false,
      error: { message: 'Builder is still loading the option chain. Try again in a moment.' },
    };
  }

  if (!expiry) {
    return { ok: false, error: { message: 'Pick an expiry before applying a strategy.' } };
  }

  if (chain.strikes.length === 0) {
    return { ok: false, error: { message: emptyChainError(expiry) } };
  }

  const attempts = variant.build(chain, expiry);

  // Empty attempts means a spec builder returned null because a required
  // strike offset is out of chain bounds — single source of truth for coverage.
  if (attempts.length === 0) {
    return { ok: false, error: { message: strikeCoverageError(template, expiry) } };
  }

  const built = attempts.flatMap((entry) => (entry.built ? [entry.built] : []));

  if (built.length < attempts.length || built.length < template.legs) {
    return {
      ok: false,
      error: { message: formatTemplateBuildError(template, expiry, attempts) },
    };
  }

  return { ok: true, legs: built };
}

interface Props {
  chain: EnrichedChainResponse | null;
  expiry: string;
  underlying: string;
  errorMessage: string | null;
  onErrorMessageChange: (message: string | null) => void;
}

export default function StrategyTemplates({
  chain,
  expiry,
  underlying,
  errorMessage,
  onErrorMessageChange,
}: Props) {
  const addLeg = useStrategyStore((state) => state.addLeg);
  const clearLegs = useStrategyStore((state) => state.clearLegs);
  const [category, setCategory] = useState<Category>('all');
  const [selectedVariants, setSelectedVariants] =
    useState<Record<string, VariantId>>(DEFAULT_VARIANTS);

  const filtered = useMemo(
    () =>
      category === 'all'
        ? TEMPLATE_CARDS
        : TEMPLATE_CARDS.filter((template) => template.category === category),
    [category],
  );

  if (!chain) return null;

  function applyVariant(template: StrategyTemplate, variant: StrategyVariant) {
    const result = buildTemplateVariant(chain, expiry, template, variant);
    if (!result.ok) {
      onErrorMessageChange(result.error.message);
      return;
    }

    onErrorMessageChange(null);
    clearLegs();
    for (const leg of result.legs) addLeg(leg, underlying);
  }

  return (
    <div className={styles.templatesSection}>
      <div className={styles.sentimentBar}>
        {CATEGORIES.map((entry) => (
          <button
            key={entry.id}
            className={styles.sentimentBtn}
            data-active={entry.id === category}
            onClick={() => setCategory(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className={styles.templateGrid}>
        {filtered.map((template) => {
          const selectedVariantId = selectedVariants[template.id] ?? template.variants[0].id;
          const selectedVariant =
            template.variants.find((entry) => entry.id === selectedVariantId) ??
            template.variants[0];
          const dragId = makeDragId(template.id, selectedVariant.id);

          return (
            <div
              key={template.id}
              className={styles.templateCard}
              data-sentiment={selectedVariant.sentiment}
              draggable
              onClick={() => applyVariant(template, selectedVariant)}
              onDragStart={(event) => {
                activeDragId = dragId;
                event.dataTransfer.setData('text/plain', dragId);
                event.dataTransfer.setData('application/x-oggregator-strategy', dragId);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              onDragEnd={() => clearActiveTemplateDrag()}
            >
              <MiniPayoff
                shape={
                  STRATEGY_SHAPES[selectedVariant.shape] ?? [
                    [0, 0],
                    [1, 0],
                  ]
                }
                width={120}
                height={48}
              />

              <div className={styles.templateCardInfo}>
                <span className={styles.templateCardName}>{template.name}</span>
                <span className={styles.templateCardHelper}>{selectedVariant.helper}</span>
                <span className={styles.templateCardMeta}>
                  {template.legs} leg{template.legs !== 1 ? 's' : ''}
                </span>
              </div>

              <div className={styles.templateVariantSwitch}>
                {template.variants.map((variant) => (
                  <button
                    key={variant.id}
                    className={styles.templateVariantBtn}
                    data-active={variant.id === selectedVariant.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedVariants((prev) => ({ ...prev, [template.id]: variant.id }));
                      applyVariant(template, variant);
                    }}
                  >
                    {variant.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {errorMessage && (
        <div className={styles.templateError}>
          {errorMessage}
          <button className={styles.templateErrorClose} onClick={() => onErrorMessageChange(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
