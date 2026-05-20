'use client';

import { useEffect, useMemo, useState } from 'react';

import { Plot, PLOTLY_3D_CONFIG, SCENE_DEFAULTS } from './plotly';

const DELTAS = [0.05, 0.14, 0.23, 0.32, 0.41, 0.5, 0.59, 0.68, 0.77, 0.86, 0.95] as const;
const TENORS = [
  '15 MAY',
  '16 MAY',
  '17 MAY',
  '18 MAY',
  '22 MAY',
  '29 MAY',
  '05 JUN',
  '26 JUN',
  '31 JUL',
  '25 SEP',
  '26 MAR',
] as const;

interface SurfaceGrid {
  text: string[][];
  x: number[];
  y: number[];
  yLabels: string[];
  z: number[][];
}

function deltaTickLabel(value: number): string {
  if (value === 0.5) return 'ATM';
  return value < 0.5 ? `${Math.round(value * 100)}ΔP` : `${Math.round((1 - value) * 100)}ΔC`;
}

function buildMockGrid(phase: number, drift: number): SurfaceGrid {
  const x = [...DELTAS];
  const y = TENORS.map((_, index) => index);
  const yLabels = [...TENORS];

  const z = y.map((tenorIndex) => {
    const tenorRatio = tenorIndex / (y.length - 1 || 1);

    return x.map((delta, deltaIndex) => {
      const smile = Math.abs(delta - 0.5) * 34;
      const term = (1 - tenorRatio) * 8;
      const hump = Math.exp(-((tenorRatio - 0.34) ** 2) / 0.02) * 10;
      const wave = Math.sin(phase + deltaIndex * 0.75 + tenorRatio * 3.2) * 1.6;
      const skew = Math.cos(phase * 0.55 + tenorRatio * 2.5) * (0.5 - delta) * 14;
      const pulse =
        Math.exp(-((delta - 0.68) ** 2) / 0.018) * Math.cos(phase * 0.7 + tenorRatio * 5.8) * 2.2;

      return 28 + smile + term + hump + wave + skew + pulse + drift;
    });
  });

  const text = yLabels.map((label) => x.map((delta) => `${label} · ${deltaTickLabel(delta)}`));

  return { text, x, y, yLabels, z };
}

export function LandingSurfacePlot() {
  const [phase, setPhase] = useState<number>(0);
  const [drift, setDrift] = useState<number>(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhase((value) => value + 0.28);
      setDrift((value) => {
        const next = value + (Math.random() - 0.5) * 0.8;
        return Math.min(Math.max(next, -2.5), 2.5);
      });
    }, 1100);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const grid = useMemo(() => buildMockGrid(phase, drift), [drift, phase]);

  const data = useMemo<Partial<Plotly.PlotData>[]>(() => {
    return [
      {
        type: 'surface',
        x: grid.x,
        y: grid.y,
        z: grid.z,
        text: grid.text as unknown as string[],
        colorscale: [
          [0, '#1e40af'],
          [0.35, '#60a5fa'],
          [0.5, '#f5f5f5'],
          [0.7, '#fb923c'],
          [1, '#ea580c'],
        ],
        showscale: true,
        colorbar: {
          title: { text: 'IV %', font: { color: '#888', size: 11 } },
          tickfont: { color: '#888', size: 10, family: "'IBM Plex Mono', monospace" },
          bgcolor: 'rgba(0,0,0,0)',
          thickness: 12,
          len: 0.62,
        },
        hovertemplate: 'Delta: %{x}<br>Expiry: %{text}<br>IV: %{z:.1f}%<extra></extra>',
        contours: {
          z: { show: true, usecolormap: true, highlightcolor: '#fff', project: { z: false } },
        } as Plotly.PlotData['contours'],
      },
    ];
  }, [grid]);

  const layout = useMemo<Partial<Plotly.Layout>>(() => {
    return {
      autosize: true,
      paper_bgcolor: '#0A0A0A',
      plot_bgcolor: '#0A0A0A',
      font: { family: "'IBM Plex Mono', monospace", size: 11, color: '#555B5E' },
      margin: { l: 0, r: 0, t: 0, b: 0 },
      scene: {
        ...SCENE_DEFAULTS,
        uirevision: 'landing-surface-mock',
        xaxis: {
          ...SCENE_DEFAULTS.xaxis,
          title: '' as never,
          tickvals: [...grid.x],
          ticktext: grid.x.map(deltaTickLabel),
        },
        yaxis: {
          ...SCENE_DEFAULTS.yaxis,
          title: '' as never,
          tickvals: [...grid.y],
          ticktext: [...grid.yLabels],
        },
        zaxis: {
          ...SCENE_DEFAULTS.zaxis,
          title: '' as never,
          ticksuffix: '%',
        },
        camera: { eye: { x: 1.5, y: -1.55, z: 0.72 } },
        aspectratio: { x: 1.45, y: 1.2, z: 0.84 },
      },
    };
  }, [grid.x, grid.y, grid.yLabels]);

  return (
    <div
      aria-label="Simulated live volatility surface inspired by the app view"
      className="h-full w-full"
      role="img"
    >
      <Plot
        data={data}
        layout={layout}
        config={PLOTLY_3D_CONFIG}
        useResizeHandler
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
