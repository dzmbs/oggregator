import { useEffect, useRef, useState } from 'react';

import { useAppStore } from '@stores/app-store';
import styles from './MyIvInput.module.css';

const DEBOUNCE_MS = 120;

export default function MyIvInput() {
  const storeIv = useAppStore((s) => s.myIv);
  const setMyIv = useAppStore((s) => s.setMyIv);

  const [local, setLocal] = useState(storeIv);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal(storeIv);
  }, [storeIv]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function onChange(value: string) {
    setLocal(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMyIv(value), DEBOUNCE_MS);
  }

  function onClear() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLocal('');
    setMyIv('');
  }

  const hasValue = local !== '';

  return (
    <div className={styles.wrap} data-active={hasValue}>
      <span className={styles.label}>My IV</span>
      <div className={styles.inputWrap}>
        <input
          type="number"
          className={styles.input}
          placeholder="—"
          value={local}
          min={0}
          max={500}
          step={0.1}
          onChange={(e) => onChange(e.target.value)}
          aria-label="My IV estimate (%)"
        />
        <span className={styles.pct}>%</span>
      </div>
      {hasValue && (
        <button className={styles.clear} onClick={onClear} aria-label="Clear My IV">
          ✕
        </button>
      )}
      <span className={styles.hint}>
        {hasValue ? 'Edge column active' : 'Enter your IV to see edge'}
      </span>
    </div>
  );
}
