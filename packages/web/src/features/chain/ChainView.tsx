import { useEffect } from "react";

import { useAppStore } from "@stores/app-store";
import { useChainQuery, useExpiries } from "./queries";
import { useChainWs } from "@hooks/useChainWs";
import { useOpenPalette } from "@components/layout";

import ExpiryBar    from "./ExpiryBar";
import StatStrip    from "./StatStrip";
import NewChainTable from "./NewChainTable";
import VenueSidebar from "./VenueSidebar";
import MyIvInput    from "./MyIvInput";
import styles       from "./ChainView.module.css";

export default function ChainView() {
  const underlying  = useAppStore((s) => s.underlying);
  const expiry      = useAppStore((s) => s.expiry);
  const setExpiry   = useAppStore((s) => s.setExpiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const toggleVenue = useAppStore((s) => s.toggleVenue);
  const myIv        = useAppStore((s) => s.myIv);
  const openPalette = useOpenPalette();

  const { data: expiries = [] } = useExpiries(underlying);
  const { data: chain, isLoading, error } = useChainQuery(underlying, expiry, activeVenues);
  const { connectionState, failedVenues } = useChainWs({ underlying, expiry, venues: activeVenues });

  useEffect(() => {
    if (expiries.length > 0 && !expiry) {
      setExpiry(expiries[0]!);
    }
  }, [expiries, expiry, setExpiry]);

  const myIvFloat = myIv !== "" ? parseFloat(myIv) / 100 : null;
  const myIvValid = myIvFloat != null && !isNaN(myIvFloat) && myIvFloat > 0;

  return (
    <div className={styles.view}>
      <VenueSidebar
        activeVenues={activeVenues}
        onToggle={toggleVenue}
        failedVenues={failedVenues}
      />

      <div className={styles.main}>
        <ExpiryBar
          underlying={underlying}
          spotPrice={chain?.stats.spotIndexUsd}
          expiries={expiries}
          selected={expiry}
          onSelect={setExpiry}
          onChangeAsset={openPalette}
        />

        {chain && (
          <StatStrip
            stats={chain.stats}
            underlying={chain.underlying}
            dte={chain.dte}
            connectionState={connectionState}
          />
        )}

        <div className={styles.tableControls}>
          <MyIvInput />
        </div>

        <div className={styles.tableArea}>
          {isLoading && !chain && (
            <div className={styles.status}>Loading chain data…</div>
          )}
          {error && (
            <div className={styles.error}>
              {error instanceof Error ? error.message : "Failed to load chain"}
            </div>
          )}
          {chain && (
            <NewChainTable
              strikes={chain.strikes}
              atmStrike={chain.stats.atmStrike}
              forwardPrice={chain.stats.forwardPriceUsd}
              activeVenues={activeVenues}
              myIv={myIvValid ? myIvFloat : null}
            />
          )}
        </div>
      </div>
    </div>
  );
}
