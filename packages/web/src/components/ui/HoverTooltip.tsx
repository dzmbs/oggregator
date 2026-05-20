import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import styles from './HoverTooltip.module.css';

type Placement = 'bottom-start' | 'bottom-end';
type OpenState = false | 'hover' | 'pinned';

interface HoverTooltipProps {
  children: ReactNode;
  content: ReactNode;
  placement?: Placement;
  className?: string;
  /** Tag for the trigger wrapper. Defaults to 'span' for inline use. */
  as?: 'span' | 'div';
  /** Inline style for the trigger wrapper (e.g. cursor). */
  style?: CSSProperties;
  /** Forwarded data attribute used for CSS hooks on the trigger. */
  dataPositive?: 'true' | 'false';
  dataInteractive?: 'true';
}

interface Pos {
  top: number;
  left?: number;
  right?: number;
}

const GAP = 6;
const VIEWPORT_MARGIN = 8;

export default function HoverTooltip({
  children,
  content,
  placement = 'bottom-start',
  className,
  as = 'span',
  style,
  dataPositive,
  dataInteractive,
}: HoverTooltipProps) {
  const [open, setOpen] = useState<OpenState>(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const computePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const tipWidth = tooltipRef.current?.offsetWidth ?? 0;
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - tipWidth);

    if (placement === 'bottom-end') {
      const desiredRight = window.innerWidth - rect.right;
      const right = Math.max(VIEWPORT_MARGIN, Math.min(desiredRight, window.innerWidth - VIEWPORT_MARGIN - tipWidth));
      setPos({ top: rect.bottom + GAP, right });
    } else {
      const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft));
      setPos({ top: rect.bottom + GAP, left });
    }
  }, [placement]);

  useLayoutEffect(() => {
    if (!open) return;
    computePos();
  }, [open, computePos]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => computePos();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, computePos]);

  useEffect(() => {
    if (open !== 'pinned') return;
    function onDocPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (tooltipRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const setTooltipNode = useCallback(
    (node: HTMLDivElement | null) => {
      tooltipRef.current = node;
      if (node) computePos();
    },
    [computePos],
  );

  function handleMouseEnter() {
    setOpen((s) => (s === 'pinned' ? s : 'hover'));
  }

  function handleMouseLeave() {
    setOpen((s) => (s === 'pinned' ? s : false));
  }

  function handleClick(e: ReactMouseEvent) {
    e.stopPropagation();
    setOpen((s) => (s === 'pinned' ? false : 'pinned'));
  }

  const Tag = as;

  return (
    <>
      <Tag
        ref={triggerRef as never}
        className={className}
        style={style}
        data-positive={dataPositive}
        data-interactive={dataInteractive}
        data-open={open ? 'true' : undefined}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={() => setOpen((s) => (s === 'pinned' ? s : 'hover'))}
        onBlur={() => setOpen((s) => (s === 'pinned' ? s : false))}
        onClick={handleClick}
        tabIndex={0}
      >
        {children}
      </Tag>
      {open &&
        pos &&
        createPortal(
          <div
            ref={setTooltipNode}
            role="tooltip"
            className={styles.tooltip}
            style={{
              top: pos.top,
              left: pos.left,
              right: pos.right,
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
