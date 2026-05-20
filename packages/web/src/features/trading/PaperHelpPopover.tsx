import { useEffect, useRef, useState } from 'react';

import { useAppStore } from '@stores/app-store';

import styles from './PaperHelpPopover.module.css';

export default function PaperHelpPopover() {
  const apiKey = useAppStore((s) => s.apiKey);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onMouseDown(event: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls="paper-help-popover"
        onClick={() => setOpen((v) => !v)}
      >
        <span>Paper trading help</span>
        <span className={styles.triggerQ} aria-hidden="true">?</span>
      </button>

      {open && (
        <div
          id="paper-help-popover"
          role="dialog"
          aria-label="Paper trading help"
          className={styles.popover}
        >
          <div className={styles.title}>Paper trading</div>
          {apiKey == null && (
            <p className={styles.paragraph}>
              Sign in via the account chip in the top bar to get an API key — your paper book is
              tied to that account.
            </p>
          )}
          <ol className={styles.steps}>
            <li>Build a strategy in the <strong>Builder</strong> tab.</li>
            <li>Click <strong>Send to paper</strong> to open a position.</li>
            <li>Manage trades here — reduce, roll, or close.</li>
            <li>The <strong>Portfolio</strong> tab shows vega/vanna/volga curves and shock P&amp;L on this paper book.</li>
          </ol>
        </div>
      )}
    </div>
  );
}
