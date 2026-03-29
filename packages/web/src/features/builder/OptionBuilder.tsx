import { useState } from 'react';

import { VENUES } from '@lib/venue-meta';
import type { NormalizedOptionContract } from '@shared/common';

import { contractToExecution } from './build-execution';
import { computeExecutionCost, rankExecutions } from './compute-execution';
import type { OrderSide, OptionSide, ExecutionCost } from './types';
import styles from './OptionBuilder.module.css';

interface OptionBuilderProps {
  underlying: string;
  expiry: string;
  strike: number;
  initialSide: OptionSide;
  callContracts: Record<string, NormalizedOptionContract>;
  putContracts: Record<string, NormalizedOptionContract>;
  underlyingPrice: number;
  onClose: () => void;
}

function fmtUsdExec(v: number): string {
  if (v >= 100) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return '$' + v.toFixed(2);
  return '$' + v.toFixed(4);
}

function formatExpiry(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

interface SavingsBadgeProps {
  best: number;
  current: number;
}

function SavingsBadge({ best, current }: SavingsBadgeProps) {
  if (current <= best) return null;
  const saved = current - best;
  const pctSaved = (saved / current) * 100;
  return (
    <span className={styles.savingsBadge}>
      save {fmtUsdExec(saved)} ({pctSaved.toFixed(1)}%)
    </span>
  );
}

interface ExecutionCardProps {
  exec: ExecutionCost;
  rank: number;
  bestCost: number;
  orderSide: OrderSide;
}

function ExecutionCard({ exec, rank, bestCost, orderSide }: ExecutionCardProps) {
  const meta = VENUES[exec.venue];
  const isBest = rank === 0;
  const isSell = orderSide === 'sell';

  return (
    <div className={styles.execCard} data-best={isBest}>
      <div className={styles.execHeader}>
        <div className={styles.execVenue}>
          {meta && <img src={meta.logo} alt={meta.label} className={styles.execLogo} />}
          <span className={styles.execName}>{meta?.label ?? exec.venue}</span>
          {isBest && <span className={styles.bestTag}>BEST</span>}
        </div>
        <span className={isSell ? styles.totalProfit : styles.totalCost}>
          {isSell ? '+' : ''}
          {fmtUsdExec(Math.abs(exec.totalCostUsd))}
        </span>
      </div>
      {!isBest && (
        <div className={styles.savingsRow}>
          <SavingsBadge best={bestCost} current={exec.totalCostUsd} />
        </div>
      )}

      <div className={styles.execBreakdown}>
        <div className={styles.breakdownRow}>
          <span className={styles.breakdownLabel}>Entry price</span>
          <span className={styles.breakdownValue}>{fmtUsdExec(exec.entryPrice)}</span>
        </div>
        <div className={styles.breakdownRow}>
          <span className={styles.breakdownLabel}>Premium</span>
          <span className={styles.breakdownValue}>{fmtUsdExec(exec.premiumUsd)}</span>
        </div>
        <div className={styles.breakdownRow}>
          <span className={styles.breakdownLabel}>Spread cost</span>
          <span className={styles.breakdownValue}>{fmtUsdExec(exec.spreadCostUsd)}</span>
        </div>
        <div className={styles.breakdownRow}>
          <span className={styles.breakdownLabel}>Taker fee</span>
          <span className={styles.breakdownValue}>{fmtUsdExec(exec.feeUsd)}</span>
        </div>
      </div>

      <div className={styles.execFooter}>
        {exec.sizeAvailable != null && (
          <span className={exec.fillable ? styles.sizeOk : styles.sizeWarn}>
            {exec.fillable ? '✓' : '⚠'} {exec.sizeAvailable.toFixed(1)} avail
          </span>
        )}
        {exec.slippageWarning && <span className={styles.slippageWarn}>slippage risk</span>}
      </div>
    </div>
  );
}

export default function OptionBuilder({
  underlying,
  expiry,
  strike,
  initialSide,
  callContracts,
  putContracts,
  underlyingPrice,
  onClose,
}: OptionBuilderProps) {
  const [optionSide, setOptionSide] = useState<OptionSide>(initialSide);
  const [orderSide, setOrderSide] = useState<OrderSide>('buy');
  const [quantity, setQuantity] = useState(1);

  const contracts = optionSide === 'call' ? callContracts : putContracts;

  const executions = Object.values(contracts).map((c) => contractToExecution(c, underlyingPrice));

  const costs = executions.map((ve) => computeExecutionCost(ve, orderSide, quantity));
  const ranked = rankExecutions(costs);
  const bestCost = ranked[0]?.totalCostUsd ?? 0;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>Execution</span>
          <span className={styles.contract}>
            {underlying} · {strike.toLocaleString()} · {formatExpiry(expiry)}
          </span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className={styles.controls}>
        <div className={styles.toggleGroup}>
          <button
            className={styles.toggleBtn}
            data-active={optionSide === 'call'}
            data-variant="call"
            onClick={() => setOptionSide('call')}
          >
            Call
          </button>
          <button
            className={styles.toggleBtn}
            data-active={optionSide === 'put'}
            data-variant="put"
            onClick={() => setOptionSide('put')}
          >
            Put
          </button>
        </div>

        <div className={styles.toggleGroup}>
          <button
            className={styles.toggleBtn}
            data-active={orderSide === 'buy'}
            onClick={() => setOrderSide('buy')}
          >
            Buy
          </button>
          <button
            className={styles.toggleBtn}
            data-active={orderSide === 'sell'}
            onClick={() => setOrderSide('sell')}
          >
            Sell
          </button>
        </div>

        <div className={styles.qtyGroup}>
          <label className={styles.qtyLabel}>Qty</label>
          <input
            type="number"
            className={styles.qtyInput}
            value={quantity}
            min={0.01}
            step={0.1}
            onChange={(e) => setQuantity(Math.max(0.01, Number(e.target.value)))}
          />
        </div>
      </div>

      <div className={styles.execList}>
        {ranked.length === 0 && (
          <div className={styles.noData}>No venue has pricing for this contract</div>
        )}
        {ranked.map((exec, i) => (
          <ExecutionCard
            key={exec.venue}
            exec={exec}
            rank={i}
            bestCost={bestCost}
            orderSide={orderSide}
          />
        ))}
      </div>

      {ranked.length >= 2 && (
        <div className={styles.summary}>
          <span className={styles.summaryText}>
            Best execution on <strong>{VENUES[ranked[0]!.venue]?.label}</strong> saves{' '}
            <strong className={styles.summaryGreen}>
              {fmtUsdExec(ranked[ranked.length - 1]!.totalCostUsd - ranked[0]!.totalCostUsd)}
            </strong>{' '}
            vs worst venue
          </span>
        </div>
      )}
    </div>
  );
}
