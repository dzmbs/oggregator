/** Tiny SVG payoff diagram for strategy template cards. */

interface MiniPayoffProps {
  /** Normalized P&L points: x in [0,1], y in [-1,1] */
  shape: Array<[number, number]>;
  width?: number;
  height?: number;
}

export default function MiniPayoff({ shape, width = 120, height = 60 }: MiniPayoffProps) {
  if (shape.length < 2) return null;

  const pad = 4;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const midY = pad + h / 2;

  function toX(nx: number) {
    return pad + nx * w;
  }
  function toY(ny: number) {
    return midY - ny * (h / 2);
  }

  // Build the P&L line path
  const linePath = shape
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${toX(x).toFixed(1)},${toY(y).toFixed(1)}`)
    .join(' ');

  // Build profit fill (above zero)
  const profitPoints: string[] = [];
  for (const [x, y] of shape) {
    profitPoints.push(`${toX(x).toFixed(1)},${toY(Math.max(0, y)).toFixed(1)}`);
  }
  const profitPath = `M${toX(shape[0]![0]).toFixed(1)},${midY} L${profitPoints.join(' L')} L${toX(shape[shape.length - 1]![0]).toFixed(1)},${midY} Z`;

  // Build loss fill (below zero)
  const lossPoints: string[] = [];
  for (const [x, y] of shape) {
    lossPoints.push(`${toX(x).toFixed(1)},${toY(Math.min(0, y)).toFixed(1)}`);
  }
  const lossPath = `M${toX(shape[0]![0]).toFixed(1)},${midY} L${lossPoints.join(' L')} L${toX(shape[shape.length - 1]![0]).toFixed(1)},${midY} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block' }}
    >
      {/* Profit zone */}
      <path d={profitPath} fill="rgba(0,233,151,0.15)" />
      {/* Loss zone */}
      <path d={lossPath} fill="rgba(203,56,85,0.15)" />
      {/* Zero line */}
      <line
        x1={pad}
        y1={midY}
        x2={width - pad}
        y2={midY}
        stroke="#333"
        strokeWidth={0.5}
        strokeDasharray="3,3"
      />
      {/* P&L line */}
      <path
        d={linePath}
        fill="none"
        stroke="url(#pnlGrad)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* No dots on mini charts — keep them clean */}
      <defs>
        <linearGradient id="pnlGrad" x1="0" y1="0" x2={width} y2="0" gradientUnits="userSpaceOnUse">
          {shape.map(([x, y], i) => (
            <stop
              key={i}
              offset={`${(x * 100).toFixed(0)}%`}
              stopColor={y >= 0 ? '#00E997' : '#CB3855'}
            />
          ))}
        </linearGradient>
      </defs>
    </svg>
  );
}

// Pre-defined shapes for each strategy type
export const STRATEGY_SHAPES: Record<string, Array<[number, number]>> = {
  'Long Call': [
    [0, -0.2],
    [0.5, -0.2],
    [0.55, 0],
    [1, 0.8],
  ],
  'Long Put': [
    [0, 0.8],
    [0.45, 0],
    [0.5, -0.2],
    [1, -0.2],
  ],
  'Short Call': [
    [0, 0.2],
    [0.5, 0.2],
    [0.55, 0],
    [1, -0.8],
  ],
  'Short Put': [
    [0, -0.8],
    [0.45, 0],
    [0.5, 0.2],
    [1, 0.2],
  ],
  'Bull Call Spread': [
    [0, -0.35],
    [0.35, -0.35],
    [0.65, 0.55],
    [1, 0.55],
  ],
  'Bear Call Spread': [
    [0, 0.55],
    [0.35, 0.55],
    [0.65, -0.35],
    [1, -0.35],
  ],
  'Call Debit Spread': [
    [0, -0.35],
    [0.35, -0.35],
    [0.65, 0.55],
    [1, 0.55],
  ],
  'Call Credit Spread': [
    [0, 0.55],
    [0.35, 0.55],
    [0.65, -0.35],
    [1, -0.35],
  ],
  'Bear Put Spread': [
    [0, 0.55],
    [0.35, 0.55],
    [0.65, -0.35],
    [1, -0.35],
  ],
  'Bull Put Spread': [
    [0, -0.35],
    [0.35, -0.35],
    [0.65, 0.55],
    [1, 0.55],
  ],
  'Put Debit Spread': [
    [0, 0.55],
    [0.35, 0.55],
    [0.65, -0.35],
    [1, -0.35],
  ],
  'Put Credit Spread': [
    [0, -0.35],
    [0.35, -0.35],
    [0.65, 0.55],
    [1, 0.55],
  ],
  'Long Straddle': [
    [0, 0.75],
    [0.35, 0.15],
    [0.5, -0.25],
    [0.65, 0.15],
    [1, 0.75],
  ],
  Straddle: [
    [0, 0.75],
    [0.35, 0.15],
    [0.5, -0.25],
    [0.65, 0.15],
    [1, 0.75],
  ],
  'Short Straddle': [
    [0, -0.75],
    [0.35, -0.15],
    [0.5, 0.25],
    [0.65, -0.15],
    [1, -0.75],
  ],
  'Long Strangle': [
    [0, 0.65],
    [0.2, 0.05],
    [0.35, -0.2],
    [0.65, -0.2],
    [0.8, 0.05],
    [1, 0.65],
  ],
  Strangle: [
    [0, 0.65],
    [0.2, 0.05],
    [0.35, -0.2],
    [0.65, -0.2],
    [0.8, 0.05],
    [1, 0.65],
  ],
  'Short Strangle': [
    [0, -0.65],
    [0.2, -0.05],
    [0.35, 0.2],
    [0.65, 0.2],
    [0.8, -0.05],
    [1, -0.65],
  ],
  'Iron Condor': [
    [0, -0.5],
    [0.15, -0.5],
    [0.25, 0.3],
    [0.4, 0.3],
    [0.6, 0.3],
    [0.75, -0.5],
    [0.85, -0.5],
    [1, -0.5],
  ],
  'Reverse Iron Condor': [
    [0, 0.5],
    [0.15, 0.5],
    [0.25, -0.3],
    [0.4, -0.3],
    [0.6, -0.3],
    [0.75, 0.5],
    [0.85, 0.5],
    [1, 0.5],
  ],
  'Call Butterfly': [
    [0, -0.1],
    [0.25, -0.1],
    [0.5, 0.7],
    [0.75, -0.1],
    [1, -0.1],
  ],
  Butterfly: [
    [0, -0.1],
    [0.25, -0.1],
    [0.5, 0.7],
    [0.75, -0.1],
    [1, -0.1],
  ],
  'Short Butterfly': [
    [0, 0.1],
    [0.25, 0.1],
    [0.5, -0.7],
    [0.75, 0.1],
    [1, 0.1],
  ],
};
