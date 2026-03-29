import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import styles from './DropdownPicker.module.css';

interface DropdownOption {
  value: string;
  label: string;
  meta?: string;
}

interface DropdownPickerProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  icon?: React.ReactNode;
  size?: 'sm' | 'md';
}

// Module-level open state keyed by instance id so multiple pickers
// don't interfere. Only one can be open at a time.
let _openId: string | null = null;
const _listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
function getSnapshot() {
  return _openId;
}
function setOpenId(id: string | null) {
  if (id === _openId) return;
  _openId = id;
  for (const cb of _listeners) cb();
}

let _nextId = 0;

export default function DropdownPicker({
  options,
  value,
  onChange,
  icon,
  size = 'md',
}: DropdownPickerProps) {
  const idRef = useRef(`dp-${_nextId++}`);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const openId = useSyncExternalStore(subscribe, getSnapshot);
  const isOpen = openId === idRef.current;

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        if (isOpen) setOpenId(null);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenId(null);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const toggle = useCallback(() => {
    setOpenId(isOpen ? null : idRef.current);
  }, [isOpen]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={styles.picker} data-open={isOpen || undefined} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        data-size={size}
        aria-expanded={isOpen}
        onClick={toggle}
      >
        {icon}
        <span className={styles.label}>{selected?.label ?? value}</span>
        {selected?.meta && <span className={styles.meta}>{selected.meta}</span>}
        <span className={styles.chevron} data-open={isOpen || undefined}>
          ▾
        </span>
      </button>

      {isOpen ? (
        <div className={styles.panel} data-size={size}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={styles.option}
              data-active={opt.value === value || undefined}
              onClick={() => {
                onChange(opt.value);
                setOpenId(null);
              }}
            >
              <span className={styles.optionLabel}>{opt.label}</span>
              {opt.meta && <span className={styles.optionMeta}>{opt.meta}</span>}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
