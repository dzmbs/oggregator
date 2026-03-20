import { useState, useEffect, useRef } from "react";

import { getTokenLogo } from "@lib/token-meta";
import { VENUE_LIST } from "@lib/venue-meta";

import styles from "./CommandPalette.module.css";

interface CommandPaletteProps {
  underlyings: string[];
  selected:    string;
  onSelect:    (underlying: string) => void;
  onClose:     () => void;
}

export default function CommandPalette({ underlyings, selected, onSelect, onClose }: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [venueFilter, setVenueFilter] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = underlyings.filter((u) =>
    u.toLowerCase().includes(search.toLowerCase()),
  );

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActiveIndex(0); }, [search, venueFilter]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          if (filtered[activeIndex]) {
            onSelect(filtered[activeIndex]!);
            onClose();
          }
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered, activeIndex, onSelect, onClose]);

  function toggleVenueFilter(venueId: string) {
    setVenueFilter((prev) => (prev === venueId ? null : venueId));
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.palette} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>Select Asset</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.searchRow}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={styles.searchIcon}>
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          <input
            ref={inputRef}
            className={styles.searchInput}
            placeholder="Search by token name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className={styles.venueCircles}>
          {VENUE_LIST.map((v) => (
            <button
              key={v.id}
              className={styles.venueCircle}
              data-active={venueFilter === v.id}
              title={v.label}
              onClick={() => toggleVenueFilter(v.id)}
            >
              <img src={v.logo} alt={v.shortLabel} className={styles.venueCircleImg} />
            </button>
          ))}
        </div>

        <div className={styles.list}>
          {filtered.map((u, i) => {
            const logo = getTokenLogo(u);
            return (
              <button
                key={u}
                className={styles.assetRow}
                data-active={i === activeIndex}
                data-selected={u === selected}
                onClick={() => { onSelect(u); onClose(); }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <div className={styles.assetLeft}>
                  {logo && <img src={logo} alt={u} className={styles.assetLogo} />}
                  <div className={styles.assetInfo}>
                    <span className={styles.assetSymbol}>{u}</span>
                    <span className={styles.assetSub}>Options</span>
                  </div>
                </div>
                <div className={styles.assetVenues}>
                  {VENUE_LIST.map((v) => (
                    <img
                      key={v.id}
                      src={v.logo}
                      alt={v.shortLabel}
                      className={styles.assetVenueLogo}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        <div className={styles.footer}>
          <span className={styles.shortcut}><kbd className={styles.kbd}>↑↓</kbd> Navigate</span>
          <span className={styles.shortcut}><kbd className={styles.kbd}>Enter</kbd> Select</span>
          <span className={styles.shortcut}><kbd className={styles.kbd}>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
