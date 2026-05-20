import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';

// Parameter types are inferred from the lightweight-charts interfaces below to
// avoid taking a direct dependency on the transitive `fancy-canvas` package.
type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

export interface PriceZone {
  low: number;
  high: number;
  profit: boolean;
}

interface PixelZone {
  top: number;
  bottom: number;
  profit: boolean;
}

const PROFIT_FILL = 'rgba(0, 233, 151, 0.08)';
const LOSS_FILL = 'rgba(203, 56, 85, 0.10)';

class ZonesRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly rects: readonly PixelZone[]) {}

  draw(): void {
    // No-op. Zones are background fills only — drawn in drawBackground so the
    // candles stay in the foreground pass.
  }

  drawBackground(target: DrawTarget): void {
    if (this.rects.length === 0) return;
    target.useBitmapCoordinateSpace((scope) => {
      const { context: ctx, bitmapSize, verticalPixelRatio } = scope;
      for (const r of this.rects) {
        const top = Math.max(0, Math.round(r.top * verticalPixelRatio));
        const bottom = Math.min(bitmapSize.height, Math.round(r.bottom * verticalPixelRatio));
        const height = bottom - top;
        if (height <= 0) continue;
        ctx.fillStyle = r.profit ? PROFIT_FILL : LOSS_FILL;
        ctx.fillRect(0, top, bitmapSize.width, height);
      }
    });
  }
}

class ZonesPaneView implements IPrimitivePaneView {
  private rects: PixelZone[] = [];

  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom';
  }

  update(zones: readonly PriceZone[], series: ISeriesApi<SeriesType>, paneHeight: number): void {
    if (paneHeight <= 0 || zones.length === 0) {
      this.rects = [];
      return;
    }

    // Resolve the visible price band so zones with ±Infinity edges or prices
    // outside the visible scale clamp to the pane edges instead of being
    // dropped (priceToCoordinate returns null in that case).
    const priceTop = series.coordinateToPrice(0);
    const priceBottom = series.coordinateToPrice(paneHeight);
    if (priceTop == null || priceBottom == null) {
      this.rects = [];
      return;
    }
    const visibleHigh = Math.max(Number(priceTop), Number(priceBottom));
    const visibleLow = Math.min(Number(priceTop), Number(priceBottom));

    const next: PixelZone[] = [];
    for (const z of zones) {
      const top = clampPriceToY(z.high, true, visibleLow, visibleHigh, series, paneHeight);
      const bottom = clampPriceToY(z.low, false, visibleLow, visibleHigh, series, paneHeight);
      if (bottom <= top) continue;
      next.push({ top, bottom, profit: z.profit });
    }
    this.rects = next;
  }

  renderer(): IPrimitivePaneRenderer {
    return new ZonesRenderer(this.rects);
  }
}

function clampPriceToY(
  price: number,
  isUpperEdge: boolean,
  visibleLow: number,
  visibleHigh: number,
  series: ISeriesApi<SeriesType>,
  paneHeight: number,
): number {
  if (!Number.isFinite(price)) return isUpperEdge ? 0 : paneHeight;
  if (price >= visibleHigh) return 0;
  if (price <= visibleLow) return paneHeight;
  const y = series.priceToCoordinate(price);
  if (y == null) return isUpperEdge ? 0 : paneHeight;
  return Math.max(0, Math.min(paneHeight, Number(y)));
}

export class ZonesPrimitive implements ISeriesPrimitive<Time> {
  private zones: readonly PriceZone[] = [];
  private attachedParam: SeriesAttachedParameter<Time, SeriesType> | null = null;
  private readonly paneView = new ZonesPaneView();
  private readonly cachedPaneViews: readonly IPrimitivePaneView[] = [this.paneView];

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.attachedParam = param;
    this.refresh();
  }

  detached(): void {
    this.attachedParam = null;
  }

  setZones(zones: readonly PriceZone[]): void {
    this.zones = zones;
    this.refresh();
    this.attachedParam?.requestUpdate();
  }

  updateAllViews(): void {
    this.refresh();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.cachedPaneViews;
  }

  private refresh(): void {
    if (!this.attachedParam) return;
    const { chart, series } = this.attachedParam;
    const paneHeight = chart.paneSize().height;
    this.paneView.update(this.zones, series, paneHeight);
  }
}
