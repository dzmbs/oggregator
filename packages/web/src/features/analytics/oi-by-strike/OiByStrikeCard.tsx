// packages/web/src/features/analytics/oi-by-strike/OiByStrikeCard.tsx
import { useMemo, useState } from 'react';
import type { EnrichedChainResponse } from '@shared/enriched';
import type { SpotCandleCurrency } from '@shared/common';

import InfoTip from '@components/ui/InfoTip';

import styles from '../AnalyticsView.module.css';
import OiByStrikeChart from './OiByStrikeChart';
import OiHeatmap from './OiHeatmap';
import { computeMaxPain } from './oi-heatmap-utils';

type Version = 'v1' | 'v2';

interface Props {
  chains: EnrichedChainResponse[];
  spotPrice: number | null;
  currency: string;
}

function isHeatmapCurrency(c: string): c is SpotCandleCurrency {
  return c === 'BTC' || c === 'ETH';
}

export default function OiByStrikeCard({ chains, spotPrice, currency }: Props) {
  const [version, setVersion] = useState<Version>('v1');
  const maxPain = useMemo(() => computeMaxPain(chains), [chains]);
  const v2Available = isHeatmapCurrency(currency);
  const effectiveVersion: Version = version === 'v2' && v2Available ? 'v2' : 'v1';

  return (
    <div className={`${styles.card} ${styles.oiCardRelative}`}>
      <div className={styles.oiHeader}>
        <div className={styles.cardTitle}>Open Interest by Strike</div>
        <div className={styles.oiControls}>
          <div className={styles.oiToggle}>
            <button
              className={styles.oiToggleBtn}
              data-active={effectiveVersion === 'v1' || undefined}
              onClick={() => setVersion('v1')}
            >
              V1
            </button>
            <button
              className={styles.oiToggleBtn}
              data-active={effectiveVersion === 'v2' || undefined}
              onClick={() => v2Available && setVersion('v2')}
              disabled={!v2Available}
              title={v2Available ? undefined : 'V2 supports BTC/ETH only'}
            >
              V2
            </button>
          </div>
          {effectiveVersion === 'v2' && (
            <InfoTip label="V2 OI Heatmap" title="V2 — EM-Anchored OI Heatmap" align="end">
              <p>
                <strong>EM cones:</strong> for each visible expiry, the tinted
                fan from <em>now</em> opens to <strong>spot ± 1σ</strong> (dense)
                and <strong>spot ± 2σ</strong> (faint) at the expiry. EM is
                computed from the ATM straddle mid (Brenner–Subrahmanyam ×1.25).
                If the straddle is too wide or stale, we fall back to interpolated
                ATM IV — those expiries get a dashed cone outline and an
                <code> ·iv </code> tag in the legend.
              </p>
              <p>
                <strong>Significance toggle (A3 / A4):</strong>
                <br />
                <strong>A3</strong> (default) — top 5 strikes by OI per expiry,
                inside its ±2σ band, then unioned across visible expiries.
                <br />
                <strong>A4 BETA</strong> — strikes whose OI exceeds mean + 1.5σ
                of the per-expiry distribution. Sparser, surfaces single
                "wall" strikes; can be empty on flat chains.
              </p>
              <p>
                <strong>Timeframe tabs (1d / 3d / 7d / 30d / 90d):</strong>
                pick the candle window that matches the expiry you care about.
                Each tab loads the finest resolution that fits the 1000-candle
                budget — 5m on 1d/3d, 30m on 7d, 1h on 30d, 4h on 90d. Visible
                range is symmetric (window past + window future) so cones
                always have empty space to the right to render in.
              </p>
              <p>
                Bands are still a <strong>live snapshot</strong>. Hover any
                strike for an EM-zone classifier, per-expiry EM badge, and a
                session OI sparkline (in-memory only — clears on refresh).
                BTC and ETH only.
              </p>
            </InfoTip>
          )}
          {maxPain != null && (
            <div className={styles.maxPainBadge}>
              Max Pain: <strong>{maxPain.toLocaleString()}</strong>
            </div>
          )}
        </div>
      </div>

      {effectiveVersion === 'v1' || !v2Available
        ? <OiByStrikeChart chains={chains} spotPrice={spotPrice} />
        : <OiHeatmap chains={chains} spotPrice={spotPrice} currency={currency} />}
    </div>
  );
}
