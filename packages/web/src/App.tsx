import { useEffect } from "react";

import { AppShell } from "@components/layout";
import { ChainView, useUnderlyings } from "@features/chain";
import { SurfaceView }               from "@features/surface";
import { GexView }                   from "@features/gex";
import { useAppStore }               from "@stores/app-store";
import { useChainQuery }             from "@features/chain/queries";

import styles from "./App.module.css";

const TABS = [
  { id: "chain",   label: "Chain" },
  { id: "surface", label: "Surface" },
  { id: "gex",     label: "GEX", badge: "PRO" },
] as const;

function GexPanel() {
  const underlying   = useAppStore((s) => s.underlying);
  const expiry       = useAppStore((s) => s.expiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const { data }     = useChainQuery(underlying, expiry, activeVenues);

  return (
    <GexView
      gex={data?.gex ?? []}
      spotPrice={data?.stats.spotIndexUsd ?? null}
    />
  );
}

export default function App() {
  const { data: underlyings = [] } = useUnderlyings();
  const activeTab = useAppStore((s) => s.activeTab);

  // Ensure underlying is in the list once loaded.
  const underlying    = useAppStore((s) => s.underlying);
  const setUnderlying = useAppStore((s) => s.setUnderlying);
  useEffect(() => {
    if (underlyings.length > 0 && !underlyings.includes(underlying)) {
      setUnderlying(underlyings[0]!);
    }
  }, [underlyings, underlying, setUnderlying]);

  return (
    <AppShell underlyings={underlyings} tabs={TABS}>
      <div className={styles.panel}>
        {activeTab === "chain"   && <ChainView />}
        {activeTab === "surface" && <SurfaceView />}
        {activeTab === "gex"     && <GexPanel />}
      </div>
    </AppShell>
  );
}
