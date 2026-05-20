// EM consensus cone primitive — V-2 visual.
//
// Spec: docs/superpowers/specs/2026-04-27-oi-heatmap-em-anchored-design.md
//
// For each visible expiry, fills a quadrilateral that pinches at "now" (= spot)
// and opens to spot ± EM at the expiry's timestamp. Drawn in two layers:
//   • outer ±2σ band, alpha 0.05
//   • inner ±1σ band, alpha 0.10
// Cones with source 'iv-fallback' get a dashed outline so it's visible at a
// glance which expiries don't have a clean straddle quote.

import type {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  ISeriesApi,
  SeriesType,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';

import type { EmSource } from './oi-em-utils';
import { STRIKE_FILTER } from './oi-em-utils';

interface BitmapCoordinatesRenderingScope {
  readonly context: CanvasRenderingContext2D;
  readonly bitmapSize: { readonly width: number; readonly height: number };
  readonly horizontalPixelRatio: number;
  readonly verticalPixelRatio: number;
}

interface CanvasRenderingTarget2D {
  useBitmapCoordinateSpace<T>(f: (scope: BitmapCoordinatesRenderingScope) => T): T;
}

export interface EmConeEntry {
  expiry: string;
  expiryTimeSec: number;
  emValue: number;
  color: string;
  source: EmSource;
}

interface ConeContext {
  spot: number;
  nowSec: number;
  entries: EmConeEntry[];
  priceToY: (price: number) => number | null;
  timeToX: (time: Time) => number | null;
}

class EmConeRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly ctx: ConeContext) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      const { context, bitmapSize, horizontalPixelRatio, verticalPixelRatio } = scope;
      const { spot, nowSec, entries, priceToY, timeToX } = this.ctx;

      const spotYMedia = priceToY(spot);
      if (spotYMedia === null) return;
      const spotYBitmap = spotYMedia * verticalPixelRatio;

      const nowXMedia = timeToX(nowSec as Time);
      if (nowXMedia === null) return;
      const nowXBitmap = nowXMedia * horizontalPixelRatio;

      for (const entry of entries) {
        const expiryXMedia = timeToX(entry.expiryTimeSec as Time);
        if (expiryXMedia === null) continue;
        const expiryXBitmap = expiryXMedia * horizontalPixelRatio;
        if (expiryXBitmap <= nowXBitmap) continue;

        const yUpper2 = priceToY(spot + STRIKE_FILTER.emBandMultiplier * entry.emValue);
        const yLower2 = priceToY(spot - STRIKE_FILTER.emBandMultiplier * entry.emValue);
        const yUpper1 = priceToY(spot + entry.emValue);
        const yLower1 = priceToY(spot - entry.emValue);

        const clipUpper = bitmapSize.width;
        const xRight = Math.min(expiryXBitmap, clipUpper);

        if (yUpper2 !== null && yLower2 !== null) {
          drawCone(
            context,
            nowXBitmap,
            spotYBitmap,
            xRight,
            yUpper2 * verticalPixelRatio,
            yLower2 * verticalPixelRatio,
            entry.color,
            0.05,
            entry.source === 'iv-fallback',
          );
        }
        if (yUpper1 !== null && yLower1 !== null) {
          drawCone(
            context,
            nowXBitmap,
            spotYBitmap,
            xRight,
            yUpper1 * verticalPixelRatio,
            yLower1 * verticalPixelRatio,
            entry.color,
            0.10,
            entry.source === 'iv-fallback',
          );
        }
      }
    });
  }
}

function drawCone(
  ctx: CanvasRenderingContext2D,
  xLeft: number,
  yPinch: number,
  xRight: number,
  yUpper: number,
  yLower: number,
  color: string,
  alpha: number,
  dashed: boolean,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(xLeft, yPinch);
  ctx.lineTo(xRight, yUpper);
  ctx.lineTo(xRight, yLower);
  ctx.closePath();
  ctx.fillStyle = withAlpha(color, alpha);
  ctx.fill();

  if (dashed) {
    ctx.strokeStyle = withAlpha(color, 0.5);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(xLeft, yPinch);
    ctx.lineTo(xRight, yUpper);
    ctx.moveTo(xLeft, yPinch);
    ctx.lineTo(xRight, yLower);
    ctx.stroke();
  }
  ctx.restore();
}

function withAlpha(color: string, alpha: number): string {
  // Accepts #RRGGBB or rgb(...) — converts to rgba(...).
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }
  return color;
}

class EmConePaneView implements IPrimitivePaneView {
  constructor(private readonly ctx: ConeContext) {}

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer {
    return new EmConeRenderer(this.ctx);
  }
}

export class EmConePrimitive implements ISeriesPrimitive<Time> {
  private spot = 0;
  private nowSec = Math.floor(Date.now() / 1000);
  private entries: EmConeEntry[] = [];
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private chart: SeriesAttachedParameter<Time>['chart'] | null = null;
  private requestUpdate: (() => void) | null = null;

  attached(param: SeriesAttachedParameter<Time>): void {
    this.series = param.series;
    this.chart = param.chart;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.series = null;
    this.chart = null;
    this.requestUpdate = null;
  }

  update(spot: number, entries: readonly EmConeEntry[]): void {
    this.spot = spot;
    this.nowSec = Math.floor(Date.now() / 1000);
    this.entries = [...entries];
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this.series || !this.chart) return [];
    const series = this.series;
    const chart = this.chart;
    const ctx: ConeContext = {
      spot: this.spot,
      nowSec: this.nowSec,
      entries: this.entries,
      priceToY: (p) => series.priceToCoordinate(p),
      timeToX: (t) => chart.timeScale().timeToCoordinate(t),
    };
    return [new EmConePaneView(ctx)];
  }
}
