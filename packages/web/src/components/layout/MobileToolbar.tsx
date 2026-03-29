import { useState } from 'react';

import { useAppStore } from '@stores/app-store';
import { useOpenPalette } from './AppShell';
import { MobileDrawer } from '@components/ui';
import { getTokenLogo } from '@lib/token-meta';
import { fmtUsdCompact, formatExpiry, dteDays } from '@lib/format';
import { useExpiries, useStats } from '@features/chain/queries';
import VenueSidebar from '@features/chain/VenueSidebar';
import MyIvInput from '@features/chain/MyIvInput';

import styles from './MobileToolbar.module.css';

export default function MobileToolbar() {
  const underlying = useAppStore((s) => s.underlying);
  const expiry = useAppStore((s) => s.expiry);
  const setExpiry = useAppStore((s) => s.setExpiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const toggleVenue = useAppStore((s) => s.toggleVenue);
  const feedStatus = useAppStore((s) => s.feedStatus);
  const openPalette = useOpenPalette();

  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: expiriesData } = useExpiries(underlying);
  const { data: marketStats } = useStats(underlying);
  const expiries = expiriesData?.expiries ?? [];

  const logo = getTokenLogo(underlying);
  const dte = expiry ? dteDays(expiry) : null;
  const spot = marketStats?.spot?.price ?? null;

  return (
    <>
      <div className={styles.bar}>
        <button className={styles.asset} onClick={openPalette}>
          {logo && <img src={logo} className={styles.logo} alt="" />}
          <span className={styles.symbol}>{underlying}</span>
          {spot != null && <span className={styles.price}>{fmtUsdCompact(spot)}</span>}
        </button>

        {expiry && (
          <button className={styles.expiry} onClick={() => setDrawerOpen(true)}>
            {formatExpiry(expiry)}
            {dte != null && (
              <span className={styles.dte} data-urgent={dte <= 1}>
                {dte}d
              </span>
            )}
          </button>
        )}

        <div className={styles.right}>
          <span className={styles.statusDot} data-state={feedStatus.connectionState} />
          <button className={styles.menuBtn} onClick={() => setDrawerOpen(true)}>
            ☰
          </button>
        </div>
      </div>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Settings">
        <div className={styles.drawerContent}>
          {/* Asset selection */}
          <div className={styles.section}>
            <div className={styles.sectionLabel}>ASSET</div>
            <button
              className={styles.assetRow}
              onClick={() => {
                setDrawerOpen(false);
                openPalette();
              }}
            >
              {logo && <img src={logo} className={styles.assetRowLogo} alt="" />}
              <span className={styles.assetRowSymbol}>{underlying}</span>
              {spot != null && <span className={styles.assetRowPrice}>{fmtUsdCompact(spot)}</span>}
              <span className={styles.assetRowChevron}>▸</span>
            </button>
          </div>

          {/* Expiry selection */}
          {expiries.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>EXPIRY</div>
              <div className={styles.expiryGrid}>
                {expiries.map((e) => {
                  const d = dteDays(e);
                  return (
                    <button
                      key={e}
                      className={styles.expiryChip}
                      data-active={e === expiry}
                      onClick={() => setExpiry(e)}
                    >
                      {formatExpiry(e)}
                      <span className={styles.chipDte} data-urgent={d <= 1}>
                        {d}d
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Venues */}
          <div className={styles.section}>
            <div className={styles.sectionLabel}>VENUES</div>
            <VenueSidebar activeVenues={activeVenues} onToggle={toggleVenue} />
          </div>

          {/* My IV */}
          <div className={styles.section}>
            <div className={styles.sectionLabel}>MY IV</div>
            <div className={styles.ivRow}>
              <MyIvInput />
            </div>
          </div>
        </div>
      </MobileDrawer>
    </>
  );
}
