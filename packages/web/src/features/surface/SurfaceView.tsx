import VolSmile from "./VolSmile";
import AtmTermStructure from "./AtmTermStructure";
import RealizedVsImplied from "./RealizedVsImplied";
import VolSurface3D from "./VolSurface3D";
import styles from "./SurfaceView.module.css";

export default function VolatilityView() {
  return (
    <div className={styles.view}>
      <div className={styles.body}>
        <div className={styles.surfaceRow}>
          <div className={styles.surfacePanel}>
            <VolSurface3D defaultUnderlying="BTC" />
          </div>
          <div className={styles.surfacePanel}>
            <VolSurface3D defaultUnderlying="ETH" />
          </div>
        </div>

        <div className={styles.chartsRow}>
          <div className={styles.chartPanel}>
            <VolSmile defaultUnderlying="BTC" />
          </div>
          <div className={styles.chartPanel}>
            <VolSmile defaultUnderlying="ETH" />
          </div>
        </div>

        <div className={styles.chartsRow}>
          <div className={styles.chartPanel}>
            <AtmTermStructure defaultUnderlying="BTC" />
          </div>
          <div className={styles.chartPanel}>
            <AtmTermStructure defaultUnderlying="ETH" />
          </div>
        </div>

        <div className={styles.chartsRow}>
          <div className={styles.chartPanel}>
            <RealizedVsImplied defaultUnderlying="BTC" />
          </div>
          <div className={styles.chartPanel}>
            <RealizedVsImplied defaultUnderlying="ETH" />
          </div>
        </div>
      </div>
    </div>
  );
}
