import { useState, useRef, useEffect } from 'react';

import { useAppStore } from '@stores/app-store';
import { useChainQuery, useExpiries } from '@features/chain/queries';
import { DropdownPicker } from '@components/ui';
import { formatExpiry, dteDays } from '@lib/format';
import { useStrategyStore } from './strategy-store';
import { repriceLeg } from './reprice';
import styles from './Architect.module.css';

interface LegInputProps {
  expiry: string;
  onExpiryChange: (expiry: string) => void;
}

export default function LegInput({ expiry, onExpiryChange }: LegInputProps) {
  const underlying = useAppStore((s) => s.underlying);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const addLeg = useStrategyStore((s) => s.addLeg);
  const [type, setType] = useState<'call' | 'put'>('call');
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy');
  const [strikeInput, setStrikeInput] = useState('');
  const [qty, setQty] = useState('1');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const strikeRef = useRef<HTMLDivElement>(null);

  const { data: chain } = useChainQuery(underlying, expiry, activeVenues);
  const strikes = chain?.strikes.map((s) => s.strike) ?? [];
  const atmStrike = chain?.stats.atmStrike ?? 0;

  const filtered = strikeInput
    ? strikes.filter((s) => s.toString().includes(strikeInput))
    : strikes;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (strikeRef.current && !strikeRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleSelectStrike(strike: number) {
    setStrikeInput(strike.toString());
    setShowSuggestions(false);
  }

  function handleAdd() {
    if (!chain || !expiry) return;

    const parsedQty = parseFloat(qty);
    const quantity = Number.isFinite(parsedQty) ? Math.max(0.001, parsedQty) : 1;

    const leg = repriceLeg(chain, activeVenues, {
      type,
      direction,
      strike: Number(strikeInput) || atmStrike,
      expiry,
      quantity,
    });

    if (!leg) return;

    addLeg(leg, underlying);
    setStrikeInput('');
  }

  return (
    <div className={styles.legInput}>
      <div className={styles.legInputRow}>
        <div className={styles.legInputToggle}>
          <button
            className={styles.toggleBtn}
            data-active={direction === 'buy'}
            data-type="buy"
            onClick={() => setDirection('buy')}
          >
            BUY
          </button>
          <button
            className={styles.toggleBtn}
            data-active={direction === 'sell'}
            data-type="sell"
            onClick={() => setDirection('sell')}
          >
            SELL
          </button>
        </div>

        <input
          type="text"
          inputMode="decimal"
          className={styles.legInputField}
          placeholder="Qty"
          value={qty}
          onChange={(e) => {
            const cleaned = e.target.value.replace(/[^\d.]/g, '');
            const firstDot = cleaned.indexOf('.');
            const normalized =
              firstDot === -1
                ? cleaned
                : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
            setQty(normalized);
          }}
          style={{ width: 60 }}
        />

        <div className={styles.strikeInputWrap} ref={strikeRef}>
          <input
            type="text"
            inputMode="numeric"
            className={styles.legInputField}
            placeholder={atmStrike ? atmStrike.toLocaleString() : 'Strike'}
            value={strikeInput}
            onChange={(e) => {
              setStrikeInput(e.target.value.replace(/\D/g, ''));
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            style={{ width: 90 }}
          />
          {showSuggestions && filtered.length > 0 && (
            <div className={styles.strikeSuggestions}>
              {filtered.slice(0, 20).map((s) => (
                <button
                  key={s}
                  className={styles.strikeSuggestion}
                  data-atm={s === atmStrike || undefined}
                  onClick={() => handleSelectStrike(s)}
                >
                  {s.toLocaleString()}
                  {s === atmStrike && <span className={styles.strikeSuggestionMeta}>ATM</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.legInputToggle}>
          <button
            className={styles.toggleBtn}
            data-active={type === 'call'}
            data-type="call"
            onClick={() => setType('call')}
          >
            CALL
          </button>
          <button
            className={styles.toggleBtn}
            data-active={type === 'put'}
            data-type="put"
            onClick={() => setType('put')}
          >
            PUT
          </button>
        </div>

        <DropdownPicker
          size="sm"
          value={expiry}
          onChange={onExpiryChange}
          options={expiries.map((e) => ({
            value: e,
            label: formatExpiry(e),
            meta: `${dteDays(e)}d`,
          }))}
        />

        <button className={styles.addLegBtn} onClick={handleAdd}>
          + Add
        </button>
      </div>
    </div>
  );
}
