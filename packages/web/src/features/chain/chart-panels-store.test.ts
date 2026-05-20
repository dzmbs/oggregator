import { describe, it, expect, beforeEach } from 'vitest';
import { useChartPanelsStore } from './chart-panels-store.js';

const samplePanel = {
  venue: 'deribit' as const,
  symbol: 'BTC-27JUN26-70000-C',
  underlying: 'BTC',
  expiry: '2026-06-27',
  strike: 70000,
  type: 'call' as const,
};

beforeEach(() => {
  useChartPanelsStore.setState({ panels: [], zCounter: 0 });
});

describe('chart-panels-store', () => {
  it('openPanel adds a new panel', () => {
    useChartPanelsStore.getState().openPanel(samplePanel);
    expect(useChartPanelsStore.getState().panels).toHaveLength(1);
  });

  it('openPanel is id-deduped — same venue+symbol focuses, does not duplicate', () => {
    const s = useChartPanelsStore.getState();
    s.openPanel(samplePanel);
    s.openPanel(samplePanel);
    expect(useChartPanelsStore.getState().panels).toHaveLength(1);
  });

  it('bringToFront sets the highest zSeq', () => {
    const s = useChartPanelsStore.getState();
    s.openPanel(samplePanel);
    s.openPanel({ ...samplePanel, strike: 65000, symbol: 'BTC-27JUN26-65000-C' });
    const [a, b] = useChartPanelsStore.getState().panels as [
      ReturnType<typeof useChartPanelsStore.getState>['panels'][number],
      ReturnType<typeof useChartPanelsStore.getState>['panels'][number],
    ];
    expect(b.zSeq).toBeGreaterThan(a.zSeq);
    s.bringToFront(a.id);
    const [a2, b2] = useChartPanelsStore.getState().panels as [
      ReturnType<typeof useChartPanelsStore.getState>['panels'][number],
      ReturnType<typeof useChartPanelsStore.getState>['panels'][number],
    ];
    expect(a2.zSeq).toBeGreaterThan(b2.zSeq);
  });

  it('closePanel removes by id', () => {
    const s = useChartPanelsStore.getState();
    s.openPanel(samplePanel);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const id = useChartPanelsStore.getState().panels[0]!.id;
    s.closePanel(id);
    expect(useChartPanelsStore.getState().panels).toHaveLength(0);
  });

  it('updatePanel merges patch by id', () => {
    const s = useChartPanelsStore.getState();
    s.openPanel(samplePanel);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const id = useChartPanelsStore.getState().panels[0]!.id;
    s.updatePanel(id, { x: 100, y: 200, range: '30d' });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const p = useChartPanelsStore.getState().panels[0]!;
    expect(p.x).toBe(100);
    expect(p.y).toBe(200);
    expect(p.range).toBe('30d');
  });

  it('clampToViewport keeps panels inside window dims', () => {
    const s = useChartPanelsStore.getState();
    s.openPanel(samplePanel);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const id = useChartPanelsStore.getState().panels[0]!.id;
    s.updatePanel(id, { x: 9999, y: 9999 });
    s.clampToViewport(1280, 720);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const p = useChartPanelsStore.getState().panels[0]!;
    expect(p.x).toBeLessThanOrEqual(1280 - p.w);
    expect(p.y).toBeLessThanOrEqual(720 - p.h);
  });
});
