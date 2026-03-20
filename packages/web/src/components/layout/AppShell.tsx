import { useState, useEffect, createContext, useContext } from "react";
import type { ReactNode } from "react";

import { CommandPalette } from "@components/ui";
import { useAppStore } from "@stores/app-store";

import TopBar from "./TopBar";
import styles from "./AppShell.module.css";

interface Tab {
  id:     string;
  label:  string;
  badge?: string;
}

interface AppShellProps {
  children:    ReactNode;
  underlyings: string[];
  tabs:        readonly Tab[];
}

const PaletteContext = createContext<() => void>(() => {});

export function useOpenPalette() {
  return useContext(PaletteContext);
}

export default function AppShell({ children, underlyings, tabs }: AppShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const underlying    = useAppStore((s) => s.underlying);
  const setUnderlying = useAppStore((s) => s.setUnderlying);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <PaletteContext.Provider value={() => setPaletteOpen(true)}>
      <div className={styles.shell}>
        <TopBar tabs={tabs} onOpenPalette={() => setPaletteOpen(true)} />
        <main className={styles.main}>{children}</main>

        {paletteOpen && (
          <CommandPalette
            underlyings={underlyings}
            selected={underlying}
            onSelect={setUnderlying}
            onClose={() => setPaletteOpen(false)}
          />
        )}
      </div>
    </PaletteContext.Provider>
  );
}
