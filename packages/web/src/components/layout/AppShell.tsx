import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { CommandPalette, ShortcutHelp } from '@components/ui';
import { useAppStore } from '@stores/app-store';

import { useIsMobile } from '@hooks/useIsMobile';
import type { TabId } from '@lib/tabs';

import TopBar from './TopBar';
import MobileNav from './MobileNav';
import MobileToolbar from './MobileToolbar';
import { NewsTicker } from './NewsTicker';
import { PaletteContext } from './palette-context';
import styles from './AppShell.module.css';

// Second key of a `g <x>` chord maps to a tab.
const GOTO_MAP: Record<string, TabId> = {
  c: 'chain',
  a: 'alpha',
  b: 'architect',
  p: 'trading',
  v: 'surface',
  f: 'flow',
  y: 'analytics',
  x: 'gex',
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

interface Tab {
  id: string;
  label: string;
  badge?: string;
}

interface AppShellProps {
  children: ReactNode;
  underlyings: string[];
  tabs: readonly Tab[];
}

export default function AppShell({ children, underlyings, tabs }: AppShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const underlying = useAppStore((s) => s.underlying);
  const setUnderlying = useAppStore((s) => s.setUnderlying);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const activeTab = useAppStore((s) => s.activeTab);
  const isMobile = useIsMobile();

  const TABS_WITHOUT_TOOLBAR: ReadonlySet<TabId> = new Set(['trading', 'portfolio', 'analytics']);
  const showToolbar = isMobile && !TABS_WITHOUT_TOOLBAR.has(activeTab);

  const pendingGotoRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clearPending() {
      if (pendingGotoRef.current) {
        clearTimeout(pendingGotoRef.current);
        pendingGotoRef.current = null;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      // Second key of a pending `g` chord
      if (pendingGotoRef.current) {
        clearPending();
        const target = GOTO_MAP[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          setActiveTab(target);
        }
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }

      if (e.key === 'g') {
        e.preventDefault();
        pendingGotoRef.current = setTimeout(clearPending, 1500);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearPending();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [setActiveTab]);

  return (
    <PaletteContext.Provider value={() => setPaletteOpen(true)}>
      <div className={styles.shell}>
        <NewsTicker />
        <TopBar tabs={tabs} onOpenPalette={() => setPaletteOpen(true)} />
        {showToolbar && <MobileToolbar />}
        <main className={styles.main}>{children}</main>
        <MobileNav />

        {paletteOpen && (
          <CommandPalette
            underlyings={underlyings}
            selected={underlying}
            onSelect={setUnderlying}
            onClose={() => setPaletteOpen(false)}
          />
        )}

        {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      </div>
    </PaletteContext.Provider>
  );
}
