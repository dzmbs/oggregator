export type { UsdAmount } from './book/money.js';
export { addUsd, subUsd, mulUsd } from './book/money.js';

export type { AccountId, Account } from './book/account.js';
export {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_ACCOUNT_LABEL,
  DEFAULT_INITIAL_CASH_USD,
} from './book/account.js';

export type {
  OptionRight,
  Order,
  OrderId,
  OrderKind,
  OrderLeg,
  OrderMode,
  OrderSide,
  OrderStatus,
} from './book/order.js';
export { newClientOrderId, newOrderId } from './book/order.js';

export type { Fill, FillId, FillSource } from './book/fill.js';
export { fillCashDelta, newFillId } from './book/fill.js';

export type { Position, PositionKey } from './book/position.js';
export { applyFillToPosition, keyFromFill, positionKeyId } from './book/position.js';

export type { PnlSnapshot, PositionMark, PositionPnl } from './book/pnl.js';
export { computePositionPnl, computeSnapshot } from './book/pnl.js';

export {
  InsufficientCashError,
  InsufficientMarginError,
  InvalidOrderError,
  MarginCheckUnavailableError,
  NoLiquidityError,
  TradingError,
} from './book/errors.js';

export type { Clock } from './gateways/clock.js';
export { FixedClock, SystemClock } from './gateways/clock.js';

export type {
  QuoteBook,
  QuoteBookLevel,
  QuoteKey,
  QuoteProvider,
} from './gateways/quote-provider.js';
export type { FillEngine, LegFillPlan } from './gateways/fill-engine.js';
export type { FillModel, FillModelInput, FillModelQuote } from './gateways/fill-model.js';
export type { OrderRepository } from './gateways/order-repository.js';
export type { CashLedgerEntry, PositionRepository } from './gateways/position-repository.js';

export {
  OrderPlacementService,
  type PlaceOrderInput,
  type PlaceOrderResult,
} from './desk/place-order.js';
export { applyFill } from './desk/apply-fill.js';
export { buildSettlementFill, type SettlementInput } from './desk/settle-expirations.js';
export { deliveryFeeUsd } from './desk/delivery-fees.js';
export { PnlService } from './desk/compute-pnl.js';
export {
  computePortfolioGreeks,
  type PortfolioGreeks,
} from './desk/portfolio-greeks.js';

export { RuntimeQuoteProvider } from './adapters/runtime-quote-provider.js';
export { PaperFillEngine } from './adapters/paper-fill-engine.js';
export { OptimisticFillModel } from './adapters/optimistic-fill-model.js';
export {
  RealisticFillModel,
  type RealisticFillModelOptions,
} from './adapters/realistic-fill-model.js';

export type {
  MarginEngine,
  MarginEstimateInput,
  MarginEstimateLeg,
  MarginEstimateResult,
  MarginPerLegBreakdown,
} from './risk/margin-engine.js';
export { NoopMarginEngine } from './risk/noop-margin-engine.js';
export {
  ApproximationMarginEngine,
  type ApproximationMarginEngineOptions,
} from './risk/approximation-margin-engine.js';
export { PostgresOrderRepository } from './adapters/postgres-order-repository.js';
export { PostgresPositionRepository } from './adapters/postgres-position-repository.js';
