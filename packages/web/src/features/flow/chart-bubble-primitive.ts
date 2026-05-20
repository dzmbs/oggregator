import type {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  ISeriesApi,
  SeriesType,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';

interface BitmapCoordinatesRenderingScope {
  readonly context: CanvasRenderingContext2D;
  readonly bitmapSize: { readonly width: number; readonly height: number };
  readonly horizontalPixelRatio: number;
  readonly verticalPixelRatio: number;
}

interface CanvasRenderingTarget2D {
  useBitmapCoordinateSpace<T>(f: (scope: BitmapCoordinatesRenderingScope) => T): T;
}

export type TradeTier = 'shrimp' | 'shark' | 'whale';

export interface TradeBubble {
  timeSec: number;
  price: number;
  side: 'buy' | 'sell';
  optionType: 'C' | 'P';
  tier: TradeTier;
  isBlock: boolean;
  tradeUid: string;
}

const TIER_RADIUS: Record<TradeTier, number> = {
  shrimp: 5,
  shark: 8,
  whale: 12,
};

const BUY_FILL = '#1FE086';
const SELL_FILL = '#F76464';
const BLOCK_STROKE = '#FFD166';
const LABEL_COLOR = '#0A0A0A';

interface BubbleContext {
  bubbles: TradeBubble[];
  priceToY: (price: number) => number | null;
  timeToX: (time: Time) => number | null;
}

class BubbleRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly ctx: BubbleContext) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      const { context, horizontalPixelRatio, verticalPixelRatio } = scope;
      const { bubbles, priceToY, timeToX } = this.ctx;

      for (const bubble of bubbles) {
        const xMedia = timeToX(bubble.timeSec as Time);
        if (xMedia === null) continue;
        const yMedia = priceToY(bubble.price);
        if (yMedia === null) continue;

        const x = xMedia * horizontalPixelRatio;
        const y = yMedia * verticalPixelRatio;
        const r = TIER_RADIUS[bubble.tier] * Math.max(horizontalPixelRatio, verticalPixelRatio);

        context.save();
        context.beginPath();
        context.arc(x, y, r, 0, Math.PI * 2);
        context.fillStyle = bubble.side === 'buy' ? BUY_FILL : SELL_FILL;
        context.globalAlpha = 0.85;
        context.fill();
        if (bubble.isBlock) {
          context.lineWidth = 2 * Math.max(horizontalPixelRatio, verticalPixelRatio);
          context.strokeStyle = BLOCK_STROKE;
          context.globalAlpha = 1;
          context.stroke();
        }
        context.globalAlpha = 1;
        context.fillStyle = LABEL_COLOR;
        context.font = `700 ${Math.round(r * 1.1)}px 'IBM Plex Mono', monospace`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(bubble.optionType, x, y + 0.5);
        context.restore();
      }
    });
  }
}

class BubblePaneView implements IPrimitivePaneView {
  constructor(private readonly ctx: BubbleContext) {}

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return new BubbleRenderer(this.ctx);
  }
}

export class TradeBubblePrimitive implements ISeriesPrimitive<Time> {
  private bubbles: TradeBubble[] = [];
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

  update(bubbles: readonly TradeBubble[]): void {
    this.bubbles = [...bubbles];
    this.requestUpdate?.();
  }

  findBubbleAt(xMedia: number, yMedia: number): TradeBubble | null {
    if (!this.series || !this.chart) return null;
    const series = this.series;
    const chart = this.chart;
    let best: { bubble: TradeBubble; distSq: number } | null = null;

    for (const bubble of this.bubbles) {
      const x = chart.timeScale().timeToCoordinate(bubble.timeSec as Time);
      if (x === null) continue;
      const y = series.priceToCoordinate(bubble.price);
      if (y === null) continue;
      const dx = x - xMedia;
      const dy = y - yMedia;
      const distSq = dx * dx + dy * dy;
      const r = TIER_RADIUS[bubble.tier];
      if (distSq > r * r) continue;
      if (best === null || distSq < best.distSq) {
        best = { bubble, distSq };
      }
    }

    return best?.bubble ?? null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this.series || !this.chart) return [];
    const series = this.series;
    const chart = this.chart;
    const ctx: BubbleContext = {
      bubbles: this.bubbles,
      priceToY: (p) => series.priceToCoordinate(p),
      timeToX: (t) => chart.timeScale().timeToCoordinate(t),
    };
    return [new BubblePaneView(ctx)];
  }
}

export function tierForNotional(notionalUsd: number): TradeTier {
  if (notionalUsd >= 100_000) return 'whale';
  if (notionalUsd >= 10_000) return 'shark';
  return 'shrimp';
}
