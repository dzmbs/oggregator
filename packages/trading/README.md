# @oggregator/trading

The paper-trading execution layer for oggregator. This package owns orders, fills, positions, cash, and PnL — sourced from the live cross-venue options chain that the rest of the monorepo aggregates.

This document describes what the package **actually does** and, equally important, **what it does not do**. It is intentionally not framed as a "matching engine" — there is no order book, no matching algorithm, and no resting-order lifecycle. It is a **quote-sourced instant-fill simulator** built on top of the aggregator's live top-of-book data.

---

## Two audiences, one source of truth

### For the strategic trader (plain-language summary)

You submit an order. The simulator looks at the best bid (for sells) or best ask (for buys) currently quoted across the five aggregated venues for that specific option. It fills your entire quantity at that single price, charges a taker fee proportional to notional, and books the resulting position. It does this **immediately** — there is no queue, no delay, no partial fill.

The realism it gives you:

- **Prices are live.** They come from the same WebSocket feeds the dashboard shows you. If the market moves, the quote you would have filled at moves with it.
- **Venue selection is real.** If you restrict to Deribit, you pay Deribit's spread and Deribit's fees. If you leave it open, the simulator picks the best cross-venue price.
- **Fees are venue-specific.** The taker rate comes from the venue's own fee schedule via the enrichment pipeline, not a flat assumption.
- **PnL is honest.** Realized PnL accrues as positions are closed against weighted-average entry; unrealized PnL marks every open leg to the cross-venue mid.

The realism it does **not** give you — be aware of this when judging a strategy:

- **No slippage beyond the top level.** A 1-contract fill and a 1,000-contract fill execute at the same price. The simulator does not walk the book because the aggregator's snapshot does not carry depth beyond top-of-book.
- **No latency.** The fill timestamp is `clock.now()` at submission. In a live venue, your order would race the tape.
- **No queue position.** Limit orders, stops, and iceberg orders are not supported at all — the only order kind is a market order that fills instantly.
- **No margin, no liquidation, no circuit breakers.** The only balance check is cash accounting through the ledger; nothing rejects a trade for risk reasons.

If your strategy's edge depends on any of those missing behaviors, this simulator will overstate it.

### For the quant / engineer (architectural detail)

The package is organized as ports-and-adapters:

```
src/
  book/           Pure domain: Order, Fill, Position, Account, PnL, money, errors
  desk/           Application services that compose the domain
    place-order.ts      OrderPlacementService — accept → fill → persist → ledger
    apply-fill.ts       Folds one Fill into position + cash ledger atomically
    compute-pnl.ts      PnlService — snapshot equity from positions + marks + cash
    portfolio-greeks.ts Stub (returns zeros; real impl deferred)
  gateways/       Ports (interfaces) — Clock, QuoteProvider, FillEngine,
                  OrderRepository, PositionRepository
  adapters/       Concrete implementations
    paper-fill-engine.ts       The "matching engine" — 100 lines
    runtime-quote-provider.ts  Reads from ChainRuntimeRegistry (live aggregator)
    postgres-order-repository.ts
    postgres-position-repository.ts
```

The domain layer (`book/`) has no I/O and no framework dependencies. All persistence and live-data access goes through ports in `gateways/`. This is what makes the tests in `book/position.test.ts` and `book/pnl.test.ts` pure and deterministic, and what would let a backtest adapter slot in beside the paper adapter without touching the domain.

---

## The fill engine in full

The entire execution logic lives in `src/adapters/paper-fill-engine.ts` (~100 lines). Pseudocode:

```
executeOrder(order, venueFilter):
  for each leg in order.legs:
    venues = leg.preferredVenues ?? venueFilter
    books  = quoteProvider.getBooks(legKey, venues)   # top-of-book per venue
    chosen = pickBestBook(books, leg.side)            # lowest ask / highest bid
    if chosen is null: throw NoLiquidityError(legIndex)
    priceUsd = chosen.ask (if buy) | chosen.bid (if sell)
    feesUsd  = priceUsd * quantity * chosen.feesTakerRate
    plan.push({leg, venue, priceUsd, feesUsd, benchmarks, underlyingSpot})
  return plan.map(toFill(filledAt = clock.now()))
```

Semantics worth knowing:

- **All-or-nothing across legs.** If any leg has no quotable side on any permitted venue, the whole order throws `NoLiquidityError` and nothing is persisted. `OrderPlacementService` marks the order `rejected` and returns the error to the caller.
- **Per-leg venue selection is independent.** Each leg picks its own best venue. A two-leg order may fill one leg on Deribit and the other on OKX, with per-leg `benchmarkBid/Ask/Mid` and `underlyingSpotUsd` recorded for later reconciliation.
- **Fees.** `feesTakerRate` is per-venue per-quote, supplied by enrichment. Default fallback is `0.0003` (see `runtime-quote-provider.ts`). The fee is charged on notional premium, not on contracts.
- **Timestamping.** A single `clock.now()` is used for all fills in an order. `SystemClock` is the production implementation; `FixedClock` is used in tests. There is no event-time vs. wall-time distinction and no attempt to model venue-side acknowledgment delay.

### Quote provider

`RuntimeQuoteProvider` calls into `ChainRuntimeRegistry` from `@oggregator/core`, acquires a chain runtime for `(underlying, expiry, venues)`, reads the current snapshot, and extracts the `(strike, optionRight)` row. It returns the set of `QuoteBook` entries for venues that have a live quote at that strike — missing venues are simply omitted, not errored. `getMark()` averages the per-venue mids across all five venues.

### Order placement service

`OrderPlacementService.place()` is the single entry point:

1. Validate legs (non-empty, positive quantity) — else `InvalidOrderError`.
2. Build the `Order` (status: `accepted`, mode: `paper`, kind: `market`) and persist it.
3. Call `FillEngine.executeOrder()`. On failure, update the order to `rejected` with the reason and rethrow.
4. On success: `saveFills()`, then `applyFill()` per fill (position fold + cash ledger entry).
5. Update the order to `filled` with `totalDebitUsd = -sum(fillCashDelta)`.

Position folding (`applyFillToPosition` in `book/position.ts`) handles the four cases explicitly: opening from flat, adding same-direction (weighted-average entry), partial close (realized delta = closedQty × (fillPrice − avgEntry) × priorSign), and flip (close full prior, reopen at fill price). Tests in `book/position.test.ts` cover these paths.

### PnL service

`PnlService.snapshot(accountId)` pulls open positions and current cash, fetches a cross-venue average mark for each open position in parallel, and returns:

```
equityUsd      = cashUsd + sum(unrealizedUsd)
unrealizedUsd  = sum( netQuantity × (mark − avgEntryPriceUsd) )    for positions with mark
realizedUsd    = sum(realizedPnlUsd)                                accrued through closes
```

Unrealized PnL for a position is `null` when no venue has a current mark — this is surfaced to the client rather than silently zeroed.

### Persistence

Postgres-backed when `DATABASE_URL` is set; a `NoopPaperTradingStore` stands in otherwise (routes return `503 persistence_unavailable` in that mode). Schema lives in `packages/db/migrations/0003_create_paper_trading.sql` and `0004_expand_paper_trading_workspace.sql`. The cash balance is derived from the `cash_ledger` table — every fill writes a `deltaUsd` entry alongside the position upsert.

### Transport

- `POST /paper/orders` — submit an order, synchronous fill, returns `{order, fills}`.
- `WS /ws/paper` — pushes `positions` and `pnl` snapshots every 1000 ms, plus `order` / `trade` / `activity` events on the in-process `PaperEventBus` when the REST side emits them. Single-process only; no cross-instance fan-out.

---

## Explicit non-goals

These are design decisions, not missing features. Listed so no one has to re-derive them by reading the code:

| Capability | Status |
| --- | --- |
| Limit, stop, stop-limit, iceberg, post-only, FOK, IOC orders | Not implemented. `OrderKind = 'market'` is the only value in the type. |
| Order book depth walking, size-dependent slippage | Not implemented. Quote provider surfaces only top-of-book. |
| Partial fills | Not implemented. Each leg fills fully or the order is rejected. |
| Latency / queue position modeling | Not implemented. `filledAt = clock.now()` at submission. |
| Margin, initial/maintenance, liquidation, circuit breakers | Not implemented. Only cash balance is tracked. The two risk DTO fields (`PaperRiskDto`, `computePortfolioGreeks`) are stubs returning zero. |
| Multiple accounts | Not implemented in transport. `DEFAULT_ACCOUNT_ID = 'paper-default'` is hardcoded in `trading-services.ts`. The domain supports account IDs; the routes do not expose them. |
| Cross-process WS fan-out | Not implemented. `PaperEventBus` is an in-process `Set<Listener>`. |
| Order cancellation / amendment | Not implemented. Fills are synchronous within `place()`, so there is no resting state to cancel. |

---

## When this simulator is useful, and when it is not

Useful for:

- Validating that a multi-leg construction prices, routes, and books correctly against real live cross-venue data.
- Tracking realized vs. unrealized PnL on real strategies at real venue fees, with real spreads.
- Exercising the PnL / positions / activity UI against a live backend.

Not useful for:

- Benchmarking execution algorithms — there is no execution to benchmark.
- Estimating impact or slippage for any size larger than what top-of-book can absorb.
- Validating risk systems, margin models, or liquidation paths — none are simulated.
- Latency-sensitive or queue-sensitive strategies — both are modeled as zero.

If future work adds a real matching engine (resting orders, depth, latency, margin), those non-goals are the scope of that work. The port boundaries in `gateways/` are deliberately the place where that substitution would happen — a new `FillEngine` implementation could sit beside `PaperFillEngine` without the domain or application services changing.
