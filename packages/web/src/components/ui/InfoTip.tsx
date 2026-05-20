import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './InfoTip.module.css';

interface Props {
  label: string;
  title?: string;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
}

export default function InfoTip({ label, title, children, align = 'center' }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const popoverId = useId();

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
    <span ref={wrapRef} className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={`More info: ${label}`}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={title ?? label}
          className={styles.popover}
          data-align={align}
        >
          {title && <div className={styles.title}>{title}</div>}
          {children}
        </div>
      )}
    </span>
  );
}
