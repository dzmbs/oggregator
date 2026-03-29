import styles from './Spinner.module.css';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export default function Spinner({ size = 'md', label }: SpinnerProps) {
  return (
    <div className={styles.wrap} data-size={size}>
      <div className={styles.ring} />
      {label && <span className={styles.label}>{label}</span>}
    </div>
  );
}
