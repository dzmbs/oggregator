import { useAppStore } from '@stores/app-store';
import styles from './MyIvInput.module.css';

export default function MyIvInput() {
  const myIv = useAppStore((s) => s.myIv);
  const setMyIv = useAppStore((s) => s.setMyIv);

  const hasValue = myIv !== '';

  return (
    <div className={styles.wrap} data-active={hasValue}>
      <span className={styles.label}>My IV</span>
      <div className={styles.inputWrap}>
        <input
          type="number"
          className={styles.input}
          placeholder="—"
          value={myIv}
          min={0}
          max={500}
          step={0.1}
          onChange={(e) => setMyIv(e.target.value)}
          aria-label="My IV estimate (%)"
        />
        <span className={styles.pct}>%</span>
      </div>
      {hasValue && (
        <button className={styles.clear} onClick={() => setMyIv('')} aria-label="Clear My IV">
          ✕
        </button>
      )}
      <span className={styles.hint}>
        {hasValue ? 'Edge column active' : 'Enter your IV to see edge'}
      </span>
    </div>
  );
}
