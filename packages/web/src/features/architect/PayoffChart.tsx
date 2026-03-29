import { useRef, useEffect, useState, useCallback } from 'react';

import type { PayoffPoint, Leg } from './payoff';
import { fmtUsd } from '@lib/format';
import styles from './Architect.module.css';

interface PayoffChartProps {
  points: PayoffPoint[];
  breakevens: number[];
  spotPrice: number;
  legs: Leg[];
  maxProfit: number | null;
  maxLoss: number | null;
  /** Available strikes for snapping during drag */
  strikes?: number[];
  /** Called when user drags a leg handle to a new strike */
  onLegStrikeDrag?: (legId: string, newStrike: number) => void;
  /** Scenario overlay: IV-shifted payoff curve */
  scenarioIvPoints?: PayoffPoint[];
  /** Scenario overlay: DTE-shifted payoff curve */
  scenarioDtePoints?: PayoffPoint[];
}

interface HoverInfo {
  x: number;
  price: number;
  pnl: number;
}

interface DragState {
  legId: string;
  legIndex: number;
  startX: number;
  currentStrike: number;
}

export default function PayoffChart({
  points,
  breakevens,
  spotPrice,
  legs,
  maxProfit,
  maxLoss,
  strikes = [],
  onLegStrikeDrag,
  scenarioIvPoints,
  scenarioDtePoints,
}: PayoffChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dataRef = useRef({
    points,
    breakevens,
    spotPrice,
    legs,
    maxProfit,
    maxLoss,
    strikes,
    scenarioIvPoints,
    scenarioDtePoints,
  });
  dataRef.current = {
    points,
    breakevens,
    spotPrice,
    legs,
    maxProfit,
    maxLoss,
    strikes,
    scenarioIvPoints,
    scenarioDtePoints,
  };

  // Layout constants
  const PAD = { top: 24, right: 55, bottom: 28, left: 10 };

  const getLayout = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const cw = w - PAD.left - PAD.right;
    const ch = h - PAD.top - PAD.bottom;
    const pts = dataRef.current.points;
    if (pts.length === 0) return null;

    const prices = pts.map((p) => p.underlyingPrice);
    const pnls = pts.map((p) => p.pnl);
    const minX = Math.min(...prices);
    const maxX = Math.max(...prices);
    const minY = Math.min(...pnls, 0);
    const maxY = Math.max(...pnls, 0);
    const rangeY = maxY - minY || 1;
    const padY = rangeY * 0.12;

    const toX = (price: number) => PAD.left + ((price - minX) / (maxX - minX)) * cw;
    const toY = (pnl: number) => PAD.top + ch - ((pnl - (minY - padY)) / (rangeY + padY * 2)) * ch;
    const fromX = (px: number) => minX + ((px - PAD.left) / cw) * (maxX - minX);

    return { w, h, cw, ch, minX, maxX, minY, maxY, toX, toY, fromX, pts, zeroY: toY(0) };
  }, []);

  const draw = useCallback(
    (hoverInfo: HoverInfo | null = null, dragState: DragState | null = null) => {
      const canvas = canvasRef.current;
      const layout = getLayout();
      if (!canvas || !layout) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = layout.w * dpr;
      canvas.height = layout.h * dpr;
      canvas.style.width = `${layout.w}px`;
      canvas.style.height = `${layout.h}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      const { w, h, toX, toY, pts, zeroY, minY, maxY } = layout;
      const { breakevens: bes, spotPrice: spot, legs: lg } = dataRef.current;

      ctx.clearRect(0, 0, w, h);

      // Zero line
      ctx.strokeStyle = '#2A2A2A';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD.left, zeroY);
      ctx.lineTo(w - PAD.right, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Profit fill
      ctx.beginPath();
      ctx.moveTo(toX(pts[0]!.underlyingPrice), zeroY);
      for (const p of pts) ctx.lineTo(toX(p.underlyingPrice), toY(Math.max(0, p.pnl)));
      ctx.lineTo(toX(pts[pts.length - 1]!.underlyingPrice), zeroY);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 233, 151, 0.08)';
      ctx.fill();

      // Loss fill
      ctx.beginPath();
      ctx.moveTo(toX(pts[0]!.underlyingPrice), zeroY);
      for (const p of pts) ctx.lineTo(toX(p.underlyingPrice), toY(Math.min(0, p.pnl)));
      ctx.lineTo(toX(pts[pts.length - 1]!.underlyingPrice), zeroY);
      ctx.closePath();
      ctx.fillStyle = 'rgba(203, 56, 85, 0.08)';
      ctx.fill();

      // P&L line
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1]!;
        const curr = pts[i]!;
        ctx.strokeStyle = (prev.pnl + curr.pnl) / 2 >= 0 ? '#00E997' : '#CB3855';
        ctx.beginPath();
        ctx.moveTo(toX(prev.underlyingPrice), toY(prev.pnl));
        ctx.lineTo(toX(curr.underlyingPrice), toY(curr.pnl));
        ctx.stroke();
      }

      // Scenario overlay curves
      const { scenarioIvPoints: ivPts, scenarioDtePoints: dtePts } = dataRef.current;
      const drawScenarioCurve = (scenPts: PayoffPoint[], color: string) => {
        if (!scenPts || scenPts.length < 2) return;
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        let started = false;
        for (const p of scenPts) {
          const sx = toX(p.underlyingPrice);
          const sy = toY(p.pnl);
          if (!started) {
            ctx.moveTo(sx, sy);
            started = true;
          } else {
            ctx.lineTo(sx, sy);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      };
      if (ivPts && ivPts.length > 0) drawScenarioCurve(ivPts, 'rgba(174, 159, 249, 0.6)');
      if (dtePts && dtePts.length > 0) drawScenarioCurve(dtePts, 'rgba(254, 249, 160, 0.55)');

      // Spot marker
      if (spot >= layout.minX && spot <= layout.maxX) {
        const sx = toX(spot);
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = '#F0B90B44';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, PAD.top);
        ctx.lineTo(sx, h - PAD.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Breakeven dots
      for (const be of bes) {
        if (be >= layout.minX && be <= layout.maxX) {
          ctx.beginPath();
          ctx.arc(toX(be), zeroY, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = '#F0B90B';
          ctx.fill();
        }
      }

      // ── Draggable leg handles ───────────────────────────────
      const uniqueStrikes = [...new Set(lg.map((l) => l.strike))];
      for (const strike of uniqueStrikes) {
        if (strike < layout.minX || strike > layout.maxX) continue;
        const x = toX(strike);
        const legsAtStrike = lg.filter((l) => l.strike === strike);
        const isDragging = dragState && legsAtStrike.some((l) => l.id === dragState.legId);

        // Vertical strike line
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = isDragging ? '#50D2C1' : '#444';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, PAD.top);
        ctx.lineTo(x, h - PAD.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Handle diamond
        const hy = zeroY;
        const sz = isDragging ? 8 : 6;
        ctx.beginPath();
        ctx.moveTo(x, hy - sz);
        ctx.lineTo(x + sz, hy);
        ctx.lineTo(x, hy + sz);
        ctx.lineTo(x - sz, hy);
        ctx.closePath();

        const hasCall = legsAtStrike.some((l) => l.type === 'call');
        const hasPut = legsAtStrike.some((l) => l.type === 'put');
        ctx.fillStyle = hasCall && hasPut ? '#50D2C1' : hasCall ? '#00E997' : '#CB3855';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Strike label below handle
        ctx.fillStyle = isDragging ? '#50D2C1' : '#666';
        ctx.font = "10px 'IBM Plex Mono', monospace";
        ctx.textAlign = 'center';
        ctx.fillText(`${(strike / 1000).toFixed(1)}k`, x, h - PAD.bottom + 14);

        // Leg type labels above handle
        const labels = legsAtStrike.map(
          (l) =>
            `${l.direction === 'buy' ? 'B' : 'S'} ${l.type === 'call' ? 'C' : 'P'}${l.quantity > 1 ? `×${l.quantity}` : ''}`,
        );
        ctx.fillStyle = '#888';
        ctx.font = "9px 'IBM Plex Mono', monospace";
        ctx.fillText(labels.join(' '), x, hy - sz - 6);
      }

      // Drag ghost — show target strike
      if (dragState) {
        const gx = toX(dragState.currentStrike);
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = '#50D2C188';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(gx, PAD.top);
        ctx.lineTo(gx, h - PAD.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#50D2C1';
        ctx.font = "bold 11px 'IBM Plex Mono', monospace";
        ctx.textAlign = 'center';
        ctx.fillText(`→ ${(dragState.currentStrike / 1000).toFixed(1)}k`, gx, PAD.top - 6);
      }

      // X-axis labels
      ctx.fillStyle = '#444';
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.textAlign = 'center';
      const xTicks = Math.min(6, Math.floor(layout.cw / 80));
      for (let i = 0; i <= xTicks; i++) {
        const price = layout.minX + (i / xTicks) * (layout.maxX - layout.minX);
        ctx.fillText(`$${(price / 1000).toFixed(0)}k`, toX(price), h - 6);
      }

      // Y-axis
      ctx.textAlign = 'left';
      ctx.fillStyle = '#444';
      ctx.fillText('$0', w - PAD.right + 4, zeroY + 4);
      if (maxY > 0) {
        ctx.fillStyle = '#00E99788';
        ctx.fillText(fmtUsd(maxY), w - PAD.right + 4, toY(maxY) + 4);
      }
      if (minY < 0) {
        ctx.fillStyle = '#CB385588';
        ctx.fillText(fmtUsd(minY), w - PAD.right + 4, toY(minY) + 4);
      }

      // Hover crosshair
      if (hoverInfo && !dragState) {
        const hx = hoverInfo.x;
        const hy = toY(hoverInfo.pnl);

        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = '#50D2C166';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hx, PAD.top);
        ctx.lineTo(hx, h - PAD.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(hx, hy, 5, 0, Math.PI * 2);
        ctx.fillStyle = hoverInfo.pnl >= 0 ? '#00E997' : '#CB3855';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.stroke();

        const tooltipW = 130;
        const tooltipH = 44;
        let tx = hx + 12;
        if (tx + tooltipW > w - 10) tx = hx - tooltipW - 12;
        let ty = hy - tooltipH - 8;
        if (ty < 4) ty = hy + 12;

        ctx.fillStyle = 'rgba(10, 10, 10, 0.92)';
        ctx.beginPath();
        ctx.roundRect(tx, ty, tooltipW, tooltipH, 6);
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#888';
        ctx.font = "10px 'IBM Plex Mono', monospace";
        ctx.textAlign = 'left';
        ctx.fillText(`Price  $${(hoverInfo.price / 1000).toFixed(1)}k`, tx + 8, ty + 16);

        ctx.fillStyle = hoverInfo.pnl >= 0 ? '#00E997' : '#CB3855';
        ctx.font = "bold 12px 'IBM Plex Mono', monospace";
        ctx.fillText(
          `P&L  ${hoverInfo.pnl >= 0 ? '+' : ''}${fmtUsd(hoverInfo.pnl)}`,
          tx + 8,
          ty + 34,
        );
      }
    },
    [getLayout],
  );

  useEffect(() => {
    draw(hover, drag);
  }, [
    points,
    breakevens,
    spotPrice,
    legs,
    maxProfit,
    maxLoss,
    hover,
    drag,
    draw,
    scenarioIvPoints,
    scenarioDtePoints,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => draw(hover, drag));
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw, hover, drag]);

  // Find closest strike to a pixel position
  const findNearestStrike = useCallback(
    (px: number): number | null => {
      const layout = getLayout();
      if (!layout) return null;
      const price = layout.fromX(px);
      const avail = dataRef.current.strikes;
      if (avail.length === 0) return null;
      return avail.reduce((best, s) => (Math.abs(s - price) < Math.abs(best - price) ? s : best));
    },
    [getLayout],
  );

  // Check if mouse is near a leg handle
  const findHandleAtPos = useCallback(
    (mx: number, my: number): { legId: string; strike: number } | null => {
      const layout = getLayout();
      if (!layout) return null;
      const lg = dataRef.current.legs;

      for (const leg of lg) {
        const hx = layout.toX(leg.strike);
        const hy = layout.zeroY;
        if (Math.abs(mx - hx) < 12 && Math.abs(my - hy) < 12) {
          return { legId: leg.id, strike: leg.strike };
        }
      }
      return null;
    },
    [getLayout],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onLegStrikeDrag) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const handle = findHandleAtPos(mx, my);
      if (handle) {
        e.preventDefault();
        const legIdx = dataRef.current.legs.findIndex((l) => l.id === handle.legId);
        setDrag({
          legId: handle.legId,
          legIndex: legIdx,
          startX: mx,
          currentStrike: handle.strike,
        });
      }
    },
    [onLegStrikeDrag, findHandleAtPos],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (drag) {
        const nearest = findNearestStrike(mx);
        if (nearest && nearest !== drag.currentStrike) {
          setDrag({ ...drag, currentStrike: nearest });
        }
        return;
      }

      // Check if hovering near a handle — change cursor
      const canvas = canvasRef.current;
      if (canvas) {
        const handle = findHandleAtPos(mx, my);
        canvas.style.cursor = handle ? 'grab' : 'crosshair';
      }

      // Normal hover
      const layout = getLayout();
      if (!layout) return;
      const pts = dataRef.current.points;
      const ratio = (mx - PAD.left) / layout.cw;
      if (ratio < 0 || ratio > 1) {
        setHover(null);
        return;
      }

      const idx = Math.round(ratio * (pts.length - 1));
      const pt = pts[Math.max(0, Math.min(pts.length - 1, idx))]!;
      const x = layout.toX(pt.underlyingPrice);
      setHover({ x, price: pt.underlyingPrice, pnl: pt.pnl });
    },
    [drag, findNearestStrike, findHandleAtPos, getLayout],
  );

  const handleMouseUp = useCallback(() => {
    if (
      drag &&
      onLegStrikeDrag &&
      drag.currentStrike !== dataRef.current.legs[drag.legIndex]?.strike
    ) {
      onLegStrikeDrag(drag.legId, drag.currentStrike);
    }
    setDrag(null);
  }, [drag, onLegStrikeDrag]);

  const handleMouseLeave = useCallback(() => {
    if (!drag) setHover(null);
  }, [drag]);

  return (
    <div className={styles.payoffChartArea} ref={containerRef}>
      <canvas
        ref={canvasRef}
        className={styles.payoffCanvas}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />
      {onLegStrikeDrag && legs.length > 0 && (
        <div className={styles.dragHint}>drag ◆ handles to adjust strikes</div>
      )}
    </div>
  );
}
