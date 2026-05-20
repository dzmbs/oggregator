import { useEffect, useMemo, useRef, useState } from 'react';

import {
  blackScholesCall,
  blackScholesPut,
  delta,
  gamma,
  vega,
  theta,
  rho,
  impliedVolNewtonRaphson,
  type OptionRight,
} from '@lib/analytics/blackScholes';

import styles from './OptionCalculator.module.css';

interface OptionCalculatorProps {
  defaultUnderlying: string;
  defaultExpiry: string;
  defaultSpot: number | null | undefined;
  onClose: () => void;
}

interface DragState {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

const PANEL_WIDTH = 380;
const RISK_FREE_RATE = 0;

export default function OptionCalculator({
  defaultUnderlying,
  defaultExpiry,
  defaultSpot,
  onClose,
}: OptionCalculatorProps) {
  const [right, setRight] = useState<OptionRight>('call');
  const [expiryDate, setExpiryDate] = useState(defaultExpiry || '');
  const [strike, setStrike] = useState('');
  const [dte, setDte] = useState(() => isoToDte(defaultExpiry));
  const [spot, setSpot] = useState(defaultSpot != null ? String(defaultSpot.toFixed(2)) : '');
  const [volPct, setVolPct] = useState('');
  const [price, setPrice] = useState('');
  const [pos, setPos] = useState(() => initialPos());
  const dragRef = useRef<DragState | null>(null);

  function onExpiryChange(value: string) {
    setExpiryDate(value);
    setDte(isoToDte(value));
  }

  function onReset() {
    setRight('call');
    setExpiryDate(defaultExpiry || '');
    setStrike('');
    setDte(isoToDte(defaultExpiry));
    setSpot(defaultSpot != null ? String(defaultSpot.toFixed(2)) : '');
    setVolPct('');
    setPrice('');
  }

  // Two-way solve. IV present → price + greeks computed from IV.
  // IV blank, price present → solve IV via Newton-Raphson, then greeks at that IV.
  const result = useMemo(() => {
    const K = num(strike);
    const S = num(spot);
    const days = num(dte);
    if (K == null || S == null || days == null || days <= 0) return null;
    const T = days / 365;

    const sigmaFromInput = num(volPct);
    const marketPrice = num(price);

    let sigma: number | null = null;
    let theoPrice: number | null = null;

    if (sigmaFromInput != null && sigmaFromInput > 0) {
      sigma = sigmaFromInput / 100;
      theoPrice =
        right === 'call'
          ? blackScholesCall(S, K, T, RISK_FREE_RATE, sigma)
          : blackScholesPut(S, K, T, RISK_FREE_RATE, sigma);
    } else if (marketPrice != null && marketPrice > 0) {
      sigma = impliedVolNewtonRaphson({
        marketPrice,
        spot: S,
        strike: K,
        T,
        r: RISK_FREE_RATE,
        right,
      });
      theoPrice = marketPrice;
    }

    if (sigma == null) return null;

    const args = { spot: S, strike: K, T, r: RISK_FREE_RATE, sigma };
    return {
      sigma,
      theoPrice,
      delta: delta({ ...args, right }),
      gamma: gamma(args),
      vega: vega(args) * 0.01,
      theta: theta({ ...args, right }) / 365,
      rho: rho({ ...args, right }) * 0.01,
    };
  }, [strike, spot, dte, volPct, price, right]);

  // Display values in the two solve fields. When user enters IV, show the derived
  // price; when user enters price, show the derived IV. Neither overrides the
  // user's own input — the displayed value is the input itself if non-empty.
  const displayPrice =
    price !== '' ? price : result?.theoPrice != null ? result.theoPrice.toFixed(2) : '';
  const displayVolPct =
    volPct !== '' ? volPct : result?.sigma != null ? (result.sigma * 100).toFixed(2) : '';

  function onHeaderMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button, input')) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
    };
    e.preventDefault();
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      const maxX = window.innerWidth - PANEL_WIDTH;
      const maxY = window.innerHeight - 100;
      const nx = clamp(d.originX + (e.clientX - d.startX), 0, Math.max(0, maxX));
      const ny = clamp(d.originY + (e.clientY - d.startY), 0, Math.max(0, maxY));
      setPos({ x: nx, y: ny });
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div className={styles.panel} style={{ left: pos.x, top: pos.y }}>
      <div className={styles.header} onMouseDown={onHeaderMouseDown}>
        <span className={styles.title}>Option Calculator</span>
        <span className={styles.subtitle}>{defaultUnderlying}</span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close calculator">
          ✕
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.rightToggle} role="tablist">
          <button
            type="button"
            className={styles.toggleBtn}
            data-active={right === 'call'}
            onClick={() => setRight('call')}
          >
            Call
          </button>
          <button
            type="button"
            className={styles.toggleBtn}
            data-active={right === 'put'}
            onClick={() => setRight('put')}
          >
            Put
          </button>
        </div>

        <div className={styles.row}>
          <Field label="Expiry Date">
            <input
              type="date"
              className={styles.input}
              value={expiryDate}
              onChange={(e) => onExpiryChange(e.target.value)}
            />
          </Field>
          <Field label="Strike">
            <input
              type="number"
              className={styles.input}
              placeholder="Enter"
              value={strike}
              min={0}
              step="any"
              onChange={(e) => setStrike(e.target.value)}
            />
          </Field>
        </div>

        <div className={styles.row}>
          <Field label="Days To Expiration">
            <input
              type="number"
              className={styles.input}
              placeholder="—"
              value={dte}
              min={0}
              step={1}
              onChange={(e) => setDte(e.target.value)}
            />
          </Field>
          <Field label="Underlying Price">
            <input
              type="number"
              className={styles.input}
              placeholder="Enter"
              value={spot}
              min={0}
              step="any"
              onChange={(e) => setSpot(e.target.value)}
            />
          </Field>
        </div>

        <div className={styles.row}>
          <Field label="Volatility (%)">
            <input
              type="number"
              className={styles.input}
              placeholder="Enter"
              value={displayVolPct}
              min={0}
              step="any"
              onChange={(e) => {
                setVolPct(e.target.value);
                setPrice('');
              }}
            />
          </Field>
          <span className={styles.swap} aria-hidden>
            ⇄
          </span>
          <Field label="Theoretical Price">
            <input
              type="number"
              className={styles.input}
              placeholder="Enter"
              value={displayPrice}
              min={0}
              step="any"
              onChange={(e) => {
                setPrice(e.target.value);
                setVolPct('');
              }}
            />
          </Field>
        </div>

        <div className={styles.greeks}>
          <Greek label="Delta" color="loss" value={result?.delta} digits={4} />
          <Greek label="Theta" color="info" value={result?.theta} digits={4} />
          <Greek label="Gamma" color="warning" value={result?.gamma} digits={6} />
          <Greek label="Vega" color="loss" value={result?.vega} digits={4} />
          <Greek label="Rho" color="primary" value={result?.rho} digits={4} />
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.resetBtn} onClick={onReset}>
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function Greek({
  label,
  color,
  value,
  digits,
}: {
  label: string;
  color: 'loss' | 'info' | 'warning' | 'primary';
  value: number | null | undefined;
  digits: number;
}) {
  return (
    <div className={styles.greek}>
      <span className={styles.greekLabel} data-color={color}>
        {label}
      </span>
      <span className={styles.greekValue}>{value != null ? value.toFixed(digits) : '—'}</span>
    </div>
  );
}

function num(s: string): number | null {
  if (s === '' || s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function isoToDte(iso: string): string {
  if (!iso) return '';
  const exp = new Date(iso + 'T08:00:00Z').getTime();
  if (!Number.isFinite(exp)) return '';
  const days = Math.max(0, Math.ceil((exp - Date.now()) / 86_400_000));
  return String(days);
}

function initialPos(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  const x = Math.max(16, window.innerWidth - PANEL_WIDTH - 96);
  const y = 96;
  return { x, y };
}
