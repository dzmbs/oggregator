import type {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  ISeriesApi,
  SeriesType,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';

import { heatColor, type HeatRow } from './oi-heatmap-utils';

interface BitmapCoordinatesRenderingScope {
  readonly context: CanvasRenderingContext2D;
  readonly bitmapSize: { readonly width: number; readonly height: number };
  readonly verticalPixelRatio: number;
}

interface CanvasRenderingTarget2D {
  useBitmapCoordinateSpace<T>(f: (scope: BitmapCoordinatesRenderingScope) => T): T;
}

const BAND_THICKNESS_PX = 4;

class HeatBandRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly rows: HeatRow[],
    private readonly maxMagnitude: number,
    private readonly priceToY: (price: number) => number | null,
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      const { context: ctx, bitmapSize, verticalPixelRatio } = scope;
      const halfHeightPx = (BAND_THICKNESS_PX / 2) * verticalPixelRatio;

      for (const row of this.rows) {
        const yMedia = this.priceToY(row.strike);
        if (yMedia === null) continue;
        const yBitmap = yMedia * verticalPixelRatio;
        ctx.fillStyle = heatColor(row, this.maxMagnitude);
        ctx.fillRect(0, yBitmap - halfHeightPx, bitmapSize.width, halfHeightPx * 2);
      }
    });
  }
}

class HeatBandPaneView implements IPrimitivePaneView {
  constructor(
    private readonly rows: HeatRow[],
    private readonly maxMagnitude: number,
    private readonly priceToY: (price: number) => number | null,
  ) {}

  renderer(): IPrimitivePaneRenderer {
    return new HeatBandRenderer(this.rows, this.maxMagnitude, this.priceToY);
  }
}

export class HeatBandPrimitive implements ISeriesPrimitive<Time> {
  private rows: HeatRow[] = [];
  private maxMagnitude = 1;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  attached(param: SeriesAttachedParameter<Time>): void {
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.series = null;
    this.requestUpdate = null;
  }

  update(rows: HeatRow[]): void {
    this.rows = rows;
    this.maxMagnitude = rows.length === 0
      ? 1
      : rows.reduce((m, r) => (r.magnitude > m ? r.magnitude : m), 0);
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this.series) return [];
    const series = this.series;
    const priceToY = (price: number): number | null => series.priceToCoordinate(price);
    return [new HeatBandPaneView(this.rows, this.maxMagnitude, priceToY)];
  }
}
