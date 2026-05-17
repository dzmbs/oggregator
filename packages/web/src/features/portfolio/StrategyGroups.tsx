import type { StrategyGroup } from '@oggregator/protocol';

import styles from './StrategyGroups.module.css';

interface Props {
  groups: StrategyGroup[];
}

const KIND_LABEL: Record<StrategyGroup['kind'], string> = {
  put_spread: 'Put spread',
  call_spread: 'Call spread',
  straddle: 'Straddle',
  strangle: 'Strangle',
  naked: 'Single leg',
};

function fmtUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtSpot(values: number[]): string {
  if (values.length === 0) return '—';
  return values
    .map((v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }))
    .join(' / ');
}

export default function StrategyGroupsPanel({ groups }: Props) {
  const interesting = groups.filter((g) => g.kind !== 'naked');
  if (interesting.length === 0) {
    return null;
  }

  return (
    <div className={styles.wrap}>
      <span className={styles.title}>Detected strategies</span>
      <div className={styles.list}>
        {interesting.map((group) => {
          const premiumClass =
            group.debitOrCredit === 'credit'
              ? styles.credit
              : group.debitOrCredit === 'debit'
                ? styles.debit
                : '';
          return (
            <div key={group.groupId} className={styles.row}>
              <span className={styles.kind} data-kind={group.kind}>
                {KIND_LABEL[group.kind]}
              </span>
              <span className={styles.detail}>
                {group.underlying} · {group.expiry} · {group.legIds.length} legs
              </span>
              <span className={`${styles.premium} ${premiumClass}`}>
                {group.debitOrCredit === 'credit' ? 'Credit' : group.debitOrCredit === 'debit' ? 'Debit' : 'Flat'}
                {' '}
                {fmtUsd(group.netEntryPremiumUsd)}
              </span>
              <span className={styles.maxRange}>
                max +{fmtUsd(group.maxProfitUsd)} / −{fmtUsd(group.maxLossUsd)}
              </span>
              <span className={styles.be}>
                BE spot {fmtSpot(group.breakEvenSpotsUsd)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
