import { useState, useEffect } from 'react';

import { useAppStore } from '@stores/app-store';
import { useOpenPalette } from '@components/layout';
import { VENUES } from '@lib/venue-meta';

import { useChainQuery, useExpiries } from '../chain/queries';
import styles from './DebugChain.module.css';

function fmt(v: number | null | undefined, decimals = 4): string {
  if (v == null) return '—';
  return v.toFixed(decimals);
}

function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  return (v * 100).toFixed(2) + '%';
}

export default function DebugChain() {
  const underlying = useAppStore((s) => s.underlying);
  const expiry = useAppStore((s) => s.expiry);
  const setExpiry = useAppStore((s) => s.setExpiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const openPalette = useOpenPalette();

  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const { data, isLoading, error } = useChainQuery(underlying, expiry, activeVenues);

  useEffect(() => {
    if (expiries.length > 0 && !expiries.includes(expiry)) {
      setExpiry(expiries[0]!);
    }
  }, [expiries, expiry, setExpiry]);

  const [filter, setFilter] = useState('');

  const strikes = (data?.strikes ?? []).filter(
    (s) => filter === '' || String(s.strike).includes(filter),
  );

  return (
    <div className={styles.page}>
      <div className={styles.controls}>
        <button className={styles.assetBtn} onClick={openPalette}>
          {underlying} ▾
        </button>

        <select
          className={styles.select}
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
        >
          {expiries.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>

        <input
          className={styles.select}
          placeholder="Filter strike…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: 130 }}
        />

        <span className={styles.refreshNote}>Auto-refresh 3s · Enriched API</span>
      </div>

      {data && (
        <div className={styles.stats}>
          <span>Spot: {fmt(data.stats.spotIndexUsd, 0)}</span>
          <span>ATM IV: {pct(data.stats.atmIv)}</span>
          <span>Skew25d: {pct(data.stats.skew25d)}</span>
          <span>ATM Strike: {data.stats.atmStrike}</span>
          <span>Strikes: {data.strikes.length}</span>
          <span>GEX entries: {data.gex.length}</span>
        </div>
      )}

      {isLoading && <div className={styles.status}>Loading…</div>}
      {error && (
        <div className={styles.status} data-error="true">
          Error: {String(error)}
        </div>
      )}

      {data && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Strike</th>
                {['deribit', 'okx', 'binance', 'bybit', 'derive'].flatMap((v) => {
                  const meta = VENUES[v];
                  return [
                    <th key={`${v}-c-iv`}>{meta?.shortLabel} C-IV</th>,
                    <th key={`${v}-c-mid`}>{meta?.shortLabel} C-Mid</th>,
                    <th key={`${v}-p-iv`}>{meta?.shortLabel} P-IV</th>,
                    <th key={`${v}-p-mid`}>{meta?.shortLabel} P-Mid</th>,
                  ];
                })}
                <th>Best C-IV</th>
                <th>Best P-IV</th>
              </tr>
            </thead>
            <tbody>
              {strikes.map((s) => (
                <tr key={s.strike}>
                  <td className={styles.strike}>{s.strike.toLocaleString()}</td>
                  {['deribit', 'okx', 'binance', 'bybit', 'derive'].flatMap((v) => {
                    const cq = s.call.venues[v as keyof typeof s.call.venues];
                    const pq = s.put.venues[v as keyof typeof s.put.venues];
                    return [
                      <td key={`${v}-c-iv`} className={styles.iv}>
                        {pct(cq?.markIv)}
                      </td>,
                      <td key={`${v}-c-mid`}>{fmt(cq?.mid, 2)}</td>,
                      <td key={`${v}-p-iv`} className={styles.iv}>
                        {pct(pq?.markIv)}
                      </td>,
                      <td key={`${v}-p-mid`}>{fmt(pq?.mid, 2)}</td>,
                    ];
                  })}
                  <td className={styles.iv}>{pct(s.call.bestIv)}</td>
                  <td className={styles.iv}>{pct(s.put.bestIv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
