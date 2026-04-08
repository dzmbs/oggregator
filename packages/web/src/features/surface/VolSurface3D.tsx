import { useState } from 'react';
import type { EnrichedChainResponse } from '@shared/enriched';

import { Spinner, DropdownPicker } from '@components/ui';
import { useUnderlyings } from '@features/chain';
import { getTokenLogo } from '@lib/token-meta';
import { VENUE_IDS, VENUE_LIST } from '@lib/venue-meta';
import { formatExpiry, dteDays } from '@lib/format';
import { Plot, PLOTLY_3D_CONFIG, SCENE_DEFAULTS } from './plotly';
import { extractSmile, deltaTickLabel } from './smile-utils';
import { useAllExpiriesSmile } from './queries';
import styles from './VolSurface3D.module.css';

const DELTA_TICKS = [
  0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50,
  0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95,
];
const DELTA_TICK_LABELS = DELTA_TICKS.map(deltaTickLabel);

interface SurfaceGrid {
  x: number[];
  y: number[];
  z: (number | null)[][];
  yLabels: string[];
}

function buildSurfaceGrid(
  chains: EnrichedChainResponse[],
  activeVenues: string[],
): SurfaceGrid {
  const x = DELTA_TICKS;
  const y: number[] = [];
  const yLabels: string[] = [];
  const z: (number | null)[][] = [];

  const sorted = chains
    .map((c) => ({ chain: c, dte: dteDays(c.expiry) }))
    .filter((e) => e.dte > 0)
    .sort((a, b) => a.dte - b.dte);

  for (const { chain, dte } of sorted) {
    const spot = chain.stats.spotIndexUsd;
    const smile = extractSmile(chain.strikes, activeVenues, spot, 'delta');

    const ivByDelta = new Map<number, number>();
    for (const p of smile) {
      const key = Math.round(p.strike * 100) / 100;
      ivByDelta.set(key, p.iv);
    }

    const row = x.map((d) => ivByDelta.get(d) ?? null);
    if (row.some((v) => v != null)) {
      y.push(dte);
      yLabels.push(formatExpiry(chain.expiry));
      z.push(row);
    }
  }

  return { x, y, z, yLabels };
}

interface Props {
  defaultUnderlying?: string;
}

export default function VolSurface3D({ defaultUnderlying = 'BTC' }: Props) {
  const [localUnderlying, setLocalUnderlying] = useState(defaultUnderlying);
  const [selectedVenue, setSelectedVenue] = useState('deribit');

  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];

  const { data: chains, isLoading } = useAllExpiriesSmile(localUnderlying, true);

  const activeVenues = selectedVenue === 'average' ? VENUE_IDS : [selectedVenue];
  const grid = chains ? buildSurfaceGrid(chains, activeVenues) : null;
  const hasData = grid != null && grid.z.length > 0;

  if (isLoading || !chains) {
    return (
      <div className={styles.wrap}>
        <Spinner size="md" label="Loading 3D surface..." />
      </div>
    );
  }

  if (!hasData) {
    return <div className={styles.empty}>No surface data</div>;
  }

  const logo = getTokenLogo(localUnderlying);

  const venueOptions = [
    { value: 'average', label: 'Average' },
    ...VENUE_LIST.map((v) => ({ value: v.id, label: v.label })),
  ];

  const plotData: Partial<Plotly.PlotData>[] = [
    {
      type: 'surface' as const,
      x: grid.x,
      y: grid.y,
      z: grid.z,
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
        len: 0.6,
      },
      hovertemplate:
        'Delta: %{x}<br>Expiry: %{text}<br>IV: %{z:.1f}%<extra></extra>',
      text: grid.yLabels.map((label, i) => `${label} (${grid.y[i]}d)`) as unknown as string[],
      contours: {
        z: { show: true, usecolormap: true, highlightcolor: '#fff', project: { z: false } },
      } as Plotly.PlotData['contours'],
    },
  ];

  const layout: Partial<Plotly.Layout> = {
    autosize: true,
    paper_bgcolor: '#0A0A0A',
    plot_bgcolor: '#0A0A0A',
    font: { family: "'IBM Plex Mono', monospace", size: 11, color: '#555B5E' },
    margin: { l: 0, r: 0, t: 0, b: 0 },
    scene: {
      ...SCENE_DEFAULTS,
      xaxis: {
        ...SCENE_DEFAULTS.xaxis,
        title: '' as never,
        tickvals: DELTA_TICKS.filter((_, i) => i % 2 === 0),
        ticktext: DELTA_TICK_LABELS.filter((_, i) => i % 2 === 0),
      },
      yaxis: {
        ...SCENE_DEFAULTS.yaxis,
        title: '' as never,
        tickvals: grid.y,
        ticktext: grid.yLabels,
      },
      zaxis: {
        ...SCENE_DEFAULTS.zaxis,
        title: '' as never,
        ticksuffix: '%',
      },
      camera: { eye: { x: 1.5, y: -1.5, z: 0.7 } },
      aspectratio: { x: 1.4, y: 1.2, z: 0.8 },
    },
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>3D IV Surface</span>
        <DropdownPicker
          size="sm"
          value={localUnderlying}
          onChange={setLocalUnderlying}
          icon={logo ? <img src={logo} alt="" className={styles.tokenLogo} /> : undefined}
          options={underlyings.map((u) => ({ value: u, label: u }))}
        />
        <DropdownPicker
          size="sm"
          value={selectedVenue}
          onChange={setSelectedVenue}
          options={venueOptions}
        />
      </div>
      <div className={styles.chartArea}>
        <Plot
          data={plotData}
          layout={layout}
          config={PLOTLY_3D_CONFIG}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}
