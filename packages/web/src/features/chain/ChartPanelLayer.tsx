// packages/web/src/features/chain/ChartPanelLayer.tsx
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobile } from '@hooks/useIsMobile';
import { useChartPanelsStore } from './chart-panels-store.js';
import FloatingChartPanel, { MobileChartModal } from './FloatingChartPanel.js';

export default function ChartPanelLayer() {
  const panels = useChartPanelsStore((s) => s.panels);
  const clamp = useChartPanelsStore((s) => s.clampToViewport);
  const isMobile = useIsMobile();

  useEffect(() => {
    function onResize() { clamp(window.innerWidth, window.innerHeight); }
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  if (typeof document === 'undefined') return null;
  let host = document.getElementById('chart-panel-layer');
  if (!host) {
    host = document.createElement('div');
    host.id = 'chart-panel-layer';
    document.body.appendChild(host);
  }
  return createPortal(
    <>
      {panels.map((p) => (
        isMobile
          ? <MobileChartModal key={p.id} panel={p} />
          : <FloatingChartPanel key={p.id} panel={p} />
      ))}
    </>,
    host,
  );
}
