import { Suspense, lazy, useState } from 'react';

import { Spinner } from '@components/ui';
import { useIsMobile } from '@hooks/useIsMobile';
import { getTokenLogo } from '@lib/token-meta';
import VolSmile from './VolSmile';
import AtmTermStructure from './AtmTermStructure';
import RealizedVsImplied from './RealizedVsImplied';
import IvRankPanel from './IvRankPanel';
import SkewHistory from './SkewHistory';
import styles from './SurfaceView.module.css';

const VolSurface3D = lazy(() => import('./VolSurface3D'));

const MOBILE_UNDERLYINGS = ['BTC', 'ETH'] as const;
type MobileUnderlying = (typeof MOBILE_UNDERLYINGS)[number];

export default function SurfaceView() {
  const isMobile = useIsMobile();
  const [mobileUnderlying, setMobileUnderlying] = useState<MobileUnderlying>('BTC');

  const showBtc = !isMobile || mobileUnderlying === 'BTC';
  const showEth = !isMobile || mobileUnderlying === 'ETH';

  return (
    <div className={styles.view}>
      {isMobile ? (
        <div className={styles.mobilePicker}>
          {MOBILE_UNDERLYINGS.map((u) => {
            const logo = getTokenLogo(u);
            return (
              <button
                key={u}
                className={styles.mobilePickerBtn}
                data-active={mobileUnderlying === u}
                onClick={() => setMobileUnderlying(u)}
              >
                {logo ? <img src={logo} alt="" className={styles.mobilePickerLogo} /> : null}
                {u}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className={styles.body}>
        <div className={styles.surfaceRow}>
          {showBtc ? (
            <div className={styles.surfacePanel}>
              <Suspense fallback={<Spinner size="md" label="Loading 3D surface..." />}>
                <VolSurface3D defaultUnderlying="BTC" />
              </Suspense>
            </div>
          ) : null}
          {showEth ? (
            <div className={styles.surfacePanel}>
              <Suspense fallback={<Spinner size="md" label="Loading 3D surface..." />}>
                <VolSurface3D defaultUnderlying="ETH" />
              </Suspense>
            </div>
          ) : null}
        </div>

        <div className={styles.chartsRow}>
          {showBtc ? (
            <div className={styles.chartPanel}>
              <IvRankPanel underlying="BTC" />
            </div>
          ) : null}
          {showEth ? (
            <div className={styles.chartPanel}>
              <IvRankPanel underlying="ETH" />
            </div>
          ) : null}
        </div>

        <div className={styles.chartsRow}>
          {showBtc ? (
            <div className={`${styles.chartPanel} ${styles.tallChartPanel}`}>
              <SkewHistory underlying="BTC" />
            </div>
          ) : null}
          {showEth ? (
            <div className={`${styles.chartPanel} ${styles.tallChartPanel}`}>
              <SkewHistory underlying="ETH" />
            </div>
          ) : null}
        </div>

        <div className={styles.chartsRow}>
          {showBtc ? (
            <div className={styles.chartPanel}>
              <VolSmile defaultUnderlying="BTC" />
            </div>
          ) : null}
          {showEth ? (
            <div className={styles.chartPanel}>
              <VolSmile defaultUnderlying="ETH" />
            </div>
          ) : null}
        </div>

        <div className={styles.chartsRow}>
          {showBtc ? (
            <div className={styles.chartPanel}>
              <AtmTermStructure defaultUnderlying="BTC" />
            </div>
          ) : null}
          {showEth ? (
            <div className={styles.chartPanel}>
              <AtmTermStructure defaultUnderlying="ETH" />
            </div>
          ) : null}
        </div>

        <div className={styles.chartsRow}>
          {showBtc ? (
            <div className={styles.chartPanel}>
              <RealizedVsImplied defaultUnderlying="BTC" />
            </div>
          ) : null}
          {showEth ? (
            <div className={styles.chartPanel}>
              <RealizedVsImplied defaultUnderlying="ETH" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
