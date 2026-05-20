import { useState } from 'react';
import { z } from 'zod';

import type { PositionLegInput } from '@oggregator/protocol';

import { useAddPosition } from './hooks/queries';
import styles from './PositionForm.module.css';

interface Props {
  defaultUnderlying?: string;
}

const PositionFormSchema = z.object({
  underlying: z.string().min(1, 'underlying is required').transform((v) => v.trim()),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expiry must be YYYY-MM-DD'),
  strike: z.coerce.number().positive('strike must be a positive number'),
  optionRight: z.enum(['call', 'put']),
  size: z.coerce.number().refine((v) => v !== 0, 'size must be a non-zero number'),
  entryPriceUsd: z.coerce.number().positive('entry price must be > 0'),
  entryIvPct: z.preprocess(
    (v) => (v == null || (typeof v === 'string' && v.trim().length === 0) ? null : v),
    z.union([z.null(), z.coerce.number().min(0).max(500)]),
  ),
});

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

    const parsed = PositionFormSchema.safeParse({
      underlying,
      expiry,
      strike,
      optionRight,
      size,
      entryPriceUsd: entryPrice,
      entryIvPct,
    });

    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setError(first?.message ?? 'invalid form');
      return;
    }

    const data = parsed.data;
    const input: PositionLegInput = {
      underlying: data.underlying,
      expiry: data.expiry,
      strike: data.strike,
      optionRight: data.optionRight,
      size: data.size,
      entryPriceUsd: data.entryPriceUsd,
      entryIv: data.entryIvPct == null ? null : data.entryIvPct / 100,
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
