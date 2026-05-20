// Adaptive numeric precision for the per-instrument chart. Picks decimal
// precision and minMove from the magnitude of the displayed prices so:
//   - Deribit inverse BTC/ETH quotes (~0.03 BTC) don't collapse onto a
//     2-decimal y-axis ("0.03" everywhere).
//   - Sub-$1 underlyings (LIT, KAS, DOGE) whose options trade in cents
//     keep candle bodies visible instead of clipping to 0–1 px.
// minMove must track precision so y-axis gridlines align with the same
// ticks the formatter renders; lightweight-charts rounds candle data to
// `minMove` when computing the scale.
export interface PriceFormatTier {
  precision: number;
  minMove: number;
}

export function pickPriceFormat(maxAbs: number): PriceFormatTier {
  if (!Number.isFinite(maxAbs) || maxAbs <= 0) return { precision: 2, minMove: 0.01 };
  if (maxAbs >= 1000) return { precision: 2, minMove: 0.01 };
  if (maxAbs >= 1) return { precision: 4, minMove: 0.0001 };
  if (maxAbs >= 0.01) return { precision: 5, minMove: 0.00001 };
  if (maxAbs >= 0.0001) return { precision: 6, minMove: 0.000001 };
  return { precision: 8, minMove: 0.00000001 };
}

export function priceFormatFromSeries(
  candleHighs: readonly number[],
  markValues: readonly number[],
): PriceFormatTier {
  let maxAbs = 0;
  for (const h of candleHighs) {
    const a = Math.abs(h);
    if (Number.isFinite(a) && a > maxAbs) maxAbs = a;
  }
  for (const v of markValues) {
    const a = Math.abs(v);
    if (Number.isFinite(a) && a > maxAbs) maxAbs = a;
  }
  return pickPriceFormat(maxAbs);
}
