import { useEffect } from "react";

import { AppShell } from "@components/layout";
import { ChainView, useUnderlyings } from "@features/chain";
import { SurfaceView }               from "@features/surface";
import { GexView }                   from "@features/gex";
import { FlowView }                  from "@features/flow";
import { DvolChart }                 from "@features/dvol";
import { useAppStore }               from "@stores/app-store";

import styles from "./App.module.css";

const TABS = [
  { id: "chain",   label: "Chain" },
  { id: "surface", label: "Surface" },
  { id: "flow",    label: "Flow", badge: "LIVE" },
  { id: "gex",     label: "GEX", badge: "PRO" },
  { id: "dvol",    label: "DVOL" },
] as const;

export default function App() {
  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];
  const activeTab = useAppStore((s) => s.activeTab);

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
        {activeTab === "flow"    && <FlowView />}
        {activeTab === "gex"     && <GexView />}
        {activeTab === "dvol"    && <DvolChart />}
      </div>
    </AppShell>
  );
}
