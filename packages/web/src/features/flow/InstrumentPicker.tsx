import { useMemo, useState } from 'react';

import type { InstrumentRow } from './chart-queries';
import styles from './InstrumentPicker.module.css';

interface InstrumentPickerProps {
  instruments: InstrumentRow[];
  selected: string | null;
  onSelect: (instrument: string) => void;
  loading?: boolean;
}

export function InstrumentPicker({ instruments, selected, onSelect, loading }: InstrumentPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return instruments;
    const q = query.toUpperCase();
    return instruments.filter((row) => row.instrument.toUpperCase().includes(q));
  }, [instruments, query]);

  const selectedRow = instruments.find((row) => row.instrument === selected) ?? null;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={loading || instruments.length === 0}
      >
        <span className={styles.triggerLabel}>
          {selectedRow ? selectedRow.instrument : loading ? 'Loading…' : 'Pick instrument'}
        </span>
        <span className={styles.caret} aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div className={styles.dropdown} role="listbox">
          <input
            className={styles.search}
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <ul className={styles.list}>
            {filtered.length === 0 ? (
              <li className={styles.empty}>No matches</li>
            ) : (
              filtered.slice(0, 100).map((row) => (
                <li key={row.instrument}>
                  <button
                    type="button"
                    className={styles.row}
                    data-selected={row.instrument === selected || undefined}
                    onClick={() => {
                      onSelect(row.instrument);
                      setOpen(false);
                      setQuery('');
                    }}
                  >
                    <span className={styles.rowName}>{row.instrument}</span>
                    <span className={styles.rowMeta}>
                      <span className={styles.rowType} data-type={row.optionType ?? 'unknown'}>
                        {row.optionType === 'call' ? 'C' : row.optionType === 'put' ? 'P' : '–'}
                      </span>
                      <span className={styles.rowCount}>{row.count} trades</span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
