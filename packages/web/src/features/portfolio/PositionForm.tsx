import { useState } from 'react';

import type { PositionLegInput } from '@oggregator/protocol';

import { useAddPosition } from './hooks/queries';
import styles from './PositionForm.module.css';

interface Props {
  defaultUnderlying?: string;
}

function parseNumber(raw: string, opts: { min?: number; max?: number } = {}): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (opts.min != null && n < opts.min) return null;
  if (opts.max != null && n > opts.max) return null;
  return n;
}

function parseSize(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

export default function PositionForm({ defaultUnderlying = 'BTC' }: Props) {
  const [underlying, setUnderlying] = useState(defaultUnderlying);
  const [expiry, setExpiry] = useState('');
  const [strike, setStrike] = useState('');
  const [optionRight, setOptionRight] = useState<'call' | 'put'>('call');
  const [size, setSize] = useState('1');
  const [entryPrice, setEntryPrice] = useState('');
  const [entryIvPct, setEntryIvPct] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addPosition = useAddPosition();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const strikeN = parseNumber(strike, { min: 0 });
    const sizeN = parseSize(size);
    const entryN = parseNumber(entryPrice, { min: 0 });
    const ivPctN = entryIvPct.trim().length > 0 ? parseNumber(entryIvPct, { min: 0, max: 500 }) : null;
    const ivFraction = ivPctN != null ? ivPctN / 100 : null;

    if (!underlying.trim()) return setError('underlying is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return setError('expiry must be YYYY-MM-DD');
    if (strikeN == null || strikeN <= 0) return setError('strike must be a positive number');
    if (sizeN == null) return setError('size must be a non-zero number');
    if (entryN == null || entryN <= 0) return setError('entry price must be > 0');

    const input: PositionLegInput = {
      underlying: underlying.trim(),
      expiry,
      strike: strikeN,
      optionRight,
      size: sizeN,
      entryPriceUsd: entryN,
      entryIv: ivFraction,
      venueHint: null,
      source: 'manual',
    };

    try {
      await addPosition.mutateAsync(input);
      setStrike('');
      setEntryPrice('');
      setEntryIvPct('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    }
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>Underlying</span>
          <input value={underlying} onChange={(e) => setUnderlying(e.target.value.toUpperCase())} placeholder="BTC" />
        </label>
        <label className={styles.field}>
          <span>Expiry</span>
          <input value={expiry} onChange={(e) => setExpiry(e.target.value)} placeholder="2026-06-27" />
        </label>
      </div>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>Strike</span>
          <input value={strike} onChange={(e) => setStrike(e.target.value)} placeholder="70000" inputMode="decimal" />
        </label>
        <label className={styles.field}>
          <span>Right</span>
          <select value={optionRight} onChange={(e) => setOptionRight(e.target.value as 'call' | 'put')}>
            <option value="call">Call</option>
            <option value="put">Put</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Size</span>
          <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="1 (negative = short)" inputMode="decimal" />
        </label>
      </div>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>Entry $</span>
          <input value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} placeholder="2500" inputMode="decimal" />
        </label>
        <label className={styles.field}>
          <span>Entry IV %</span>
          <input value={entryIvPct} onChange={(e) => setEntryIvPct(e.target.value)} placeholder="62" inputMode="decimal" />
        </label>
      </div>
      {error != null && <div className={styles.error}>{error}</div>}
      <button type="submit" className={styles.submit} disabled={addPosition.isPending}>
        {addPosition.isPending ? 'Adding…' : 'Add leg'}
      </button>
    </form>
  );
}
