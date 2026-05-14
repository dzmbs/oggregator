'use client';

import { useEffect, useMemo, useState } from 'react';

type SceneMode = 'surface' | 'skew' | 'term' | 'liquidity';
type DetailLevel = 'overview' | 'regional' | 'point';

interface SurfacePoint {
  id: string;
  xIndex: number;
  yIndex: number;
  strikeLabel: string;
  tenorLabel: string;
  iv: number;
  change: number;
  confidence: number;
  liquidity: number;
  spreadBps: number;
  screenX: number;
  screenY: number;
  depth: number;
}

const STRIKE_LABELS = [
  '70d',
  '75d',
  '80d',
  '85d',
  '90d',
  '95d',
  'atm',
  '105d',
  '110d',
  '115d',
  '120d',
  '125d',
  '130d',
] as const;

const TENOR_LABELS = ['1w', '2w', '1m', '2m', '3m', '6m', '9m', '1y'] as const;

const MODES: readonly { id: SceneMode; label: string; caption: string }[] = [
  { id: 'surface', label: 'Surface', caption: 'Whole-book topology' },
  { id: 'skew', label: 'Skew', caption: 'Wing asymmetry' },
  { id: 'term', label: 'Term', caption: 'Tenor ridges' },
  { id: 'liquidity', label: 'Liquidity', caption: 'Executable depth' },
];

const DETAIL_LEVELS: readonly { id: DetailLevel; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'regional', label: 'Regional' },
  { id: 'point', label: 'Point detail' },
];

const DETAIL_INDEX_BY_LEVEL: Record<DetailLevel, number> = {
  overview: 0,
  regional: 1,
  point: 2,
};

const LEVEL_BY_DETAIL_INDEX: Record<number, DetailLevel> = {
  0: 'overview',
  1: 'regional',
  2: 'point',
};

const DETAIL_COPY: Record<
  DetailLevel,
  { title: string; description: string; overlay: string; telemetry: string }
> = {
  overview: {
    title: 'Overview orbit',
    description: 'Read the full vol regime before you commit to a node.',
    overlay: 'Ghost prior close + event ridge',
    telemetry: 'Labels stay suppressed outside the focus cone.',
  },
  regional: {
    title: 'Regional focus',
    description: 'Local contours and cross-sections appear as you close on a tenor corridor.',
    overlay: 'Venue spread ribbons + confidence mesh',
    telemetry: 'Clustered labels emerge around the active neighborhood.',
  },
  point: {
    title: 'Point detail',
    description:
      'Lock a node to inspect IV, spread, liquidity, and confidence without leaving the scene.',
    overlay: 'Pinned callout + local rails',
    telemetry: 'Micro telemetry replaces detached detail cards.',
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getModeColor(
  mode: SceneMode,
  point: Pick<SurfacePoint, 'change' | 'confidence' | 'liquidity' | 'iv'>,
): string {
  if (mode === 'liquidity') {
    const alpha = 0.28 + point.liquidity * 0.5;
    return `rgba(80, 210, 193, ${alpha.toFixed(3)})`;
  }

  if (mode === 'term') {
    const alpha = 0.2 + point.iv * 0.42;
    return `rgba(136, 182, 255, ${alpha.toFixed(3)})`;
  }

  if (mode === 'skew') {
    const warm = point.change > 0;
    return warm
      ? `rgba(251, 191, 36, ${(0.22 + Math.abs(point.change) * 0.9).toFixed(3)})`
      : `rgba(96, 165, 250, ${(0.2 + Math.abs(point.change) * 0.9).toFixed(3)})`;
  }

  return `rgba(80, 210, 193, ${(0.18 + point.confidence * 0.45).toFixed(3)})`;
}

function getProjectedPoint(
  xNorm: number,
  yNorm: number,
  iv: number,
  yaw: number,
  pitch: number,
): { screenX: number; screenY: number; depth: number } {
  const baseX = (xNorm - 0.5) * 720;
  const baseY = (yNorm - 0.5) * 430;
  const baseZ = iv * 240;

  const yawRadians = (yaw * Math.PI) / 180;
  const pitchRadians = (pitch * Math.PI) / 180;

  const yawX = baseX * Math.cos(yawRadians) - baseY * Math.sin(yawRadians);
  const yawY = baseX * Math.sin(yawRadians) + baseY * Math.cos(yawRadians);

  const pitchY = yawY * Math.cos(pitchRadians) - baseZ * Math.sin(pitchRadians);
  const depth = yawY * Math.sin(pitchRadians) + baseZ * Math.cos(pitchRadians);

  return {
    screenX: 540 + yawX,
    screenY: 360 + pitchY,
    depth,
  };
}

function getDetailLevel(zoomIndex: number): DetailLevel {
  return LEVEL_BY_DETAIL_INDEX[clamp(zoomIndex, 0, 2)] ?? 'overview';
}

export function VolatilitySurfaceExperience() {
  const [mode, setMode] = useState<SceneMode>('surface');
  const [zoomIndex, setZoomIndex] = useState<number>(1);
  const [phase, setPhase] = useState<number>(0);
  const [isPinned, setIsPinned] = useState<boolean>(false);
  const [pointer, setPointer] = useState<{ x: number; y: number }>({ x: 0.54, y: 0.38 });
  const [orbit, setOrbit] = useState<{ yaw: number; pitch: number }>({ yaw: -32, pitch: 63 });

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhase((value) => value + 1);
    }, 1200);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const detailLevel = getDetailLevel(zoomIndex);

  const surface = useMemo(() => {
    const zoom = 1 + zoomIndex * 0.08;
    const surfacePoints: SurfacePoint[] = [];

    for (const [yIndex, tenorLabel] of TENOR_LABELS.entries()) {
      for (const [xIndex, strikeLabel] of STRIKE_LABELS.entries()) {
        const xNorm = xIndex / (STRIKE_LABELS.length - 1);
        const yNorm = yIndex / (TENOR_LABELS.length - 1);
        const smileCurve = Math.abs(xNorm - 0.5) * 0.18;
        const tenorLift = yNorm * 0.15;
        const eventRidge = Math.exp(-((yNorm - 0.33) ** 2) / 0.012) * 0.09;
        const breathing = Math.sin(phase * 0.28 + xNorm * 4.8 + yNorm * 2.2) * 0.012;
        const localizedPulse =
          Math.cos(phase * 0.22 + yNorm * 5.6) * Math.exp(-((xNorm - 0.72) ** 2) / 0.02) * 0.018;
        const iv = 0.36 + smileCurve + tenorLift + eventRidge + breathing + localizedPulse;
        const change = Math.sin(phase * 0.18 + xNorm * 5.1 - yNorm * 2.4) * 0.035;
        const confidence = clamp(0.45 + yNorm * 0.42 - Math.abs(xNorm - 0.5) * 0.24, 0.22, 0.98);
        const liquidity = clamp(
          0.32 + (1 - Math.abs(xNorm - 0.56) * 1.3) * 0.44 + yNorm * 0.18,
          0.12,
          0.96,
        );
        const spreadBps = Math.round(8 + (1 - confidence) * 12 + (1 - liquidity) * 10);
        const projection = getProjectedPoint(xNorm, yNorm, iv * zoom, orbit.yaw, orbit.pitch);

        surfacePoints.push({
          id: `${strikeLabel}-${tenorLabel}`,
          xIndex,
          yIndex,
          strikeLabel,
          tenorLabel,
          iv,
          change,
          confidence,
          liquidity,
          spreadBps,
          screenX: projection.screenX,
          screenY: projection.screenY,
          depth: projection.depth,
        });
      }
    }

    const horizontalLines = TENOR_LABELS.map((_, yIndex) => {
      const points = surfacePoints.filter((point) => point.yIndex === yIndex);
      return points
        .map((point) => `${point.screenX.toFixed(1)},${point.screenY.toFixed(1)}`)
        .join(' ');
    });

    const verticalLines = STRIKE_LABELS.map((_, xIndex) => {
      const points = surfacePoints.filter((point) => point.xIndex === xIndex);
      return points
        .map((point) => `${point.screenX.toFixed(1)},${point.screenY.toFixed(1)}`)
        .join(' ');
    });

    const firstPoint = surfacePoints[0];

    if (!firstPoint) {
      throw new Error('Volatility surface data generation failed.');
    }

    const focusPoint = surfacePoints.reduce(
      (nearest, point) => {
        const pointX = point.xIndex / (STRIKE_LABELS.length - 1);
        const pointY = point.yIndex / (TENOR_LABELS.length - 1);
        const distance = Math.hypot(pointX - pointer.x, pointY - pointer.y);

        if (distance < nearest.distance) {
          return { distance, point };
        }

        return nearest;
      },
      { distance: Number.POSITIVE_INFINITY, point: firstPoint },
    );

    const focused = focusPoint.point;
    const nearbyPoints = surfacePoints.filter((point) => {
      const pointX = point.xIndex / (STRIKE_LABELS.length - 1);
      const pointY = point.yIndex / (TENOR_LABELS.length - 1);
      const distance = Math.hypot(pointX - pointer.x, pointY - pointer.y);
      return (
        distance < (detailLevel === 'overview' ? 0.09 : detailLevel === 'regional' ? 0.16 : 0.24)
      );
    });

    const telemetry = {
      liveIv: `${(focused.iv * 100).toFixed(1)}%`,
      skewShift: `${focused.change >= 0 ? '+' : ''}${(focused.change * 100).toFixed(1)} vol pts`,
      spread: `${focused.spreadBps} bps`,
      confidence: `${Math.round(focused.confidence * 100)}%`,
      liquidity: `${Math.round(focused.liquidity * 100)}%`,
    };

    return {
      focused,
      horizontalLines,
      nearbyPoints,
      surfacePoints,
      telemetry,
      verticalLines,
    };
  }, [detailLevel, orbit.pitch, orbit.yaw, phase, pointer.x, pointer.y, zoomIndex]);

  const detailCopy = DETAIL_COPY[detailLevel];

  function updatePointer(nextX: number, nextY: number): void {
    if (isPinned) {
      return;
    }

    setPointer({
      x: clamp(nextX, 0.06, 0.94),
      y: clamp(nextY, 0.08, 0.92),
    });
  }

  return (
    <div className="landing-surface-shell relative overflow-hidden rounded-[2rem] border border-[color:var(--landing-border-strong)] bg-[rgba(6,9,12,0.88)] px-4 py-4 shadow-[0_40px_140px_rgba(0,0,0,0.5)] sm:px-6 sm:py-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(80,210,193,0.18),transparent_32%),radial-gradient(circle_at_82%_14%,rgba(136,182,255,0.16),transparent_30%),radial-gradient(circle_at_50%_100%,rgba(80,210,193,0.12),transparent_42%)]" />
      <div className="relative overflow-hidden rounded-[1.6rem] border border-white/8 bg-[linear-gradient(180deg,rgba(14,19,24,0.98),rgba(7,10,13,0.96))]">
        <div className="absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top,rgba(80,210,193,0.14),transparent_70%)]" />

        <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--landing-loss)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--landing-warning)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--landing-success)]" />
            </div>
            <span>Volatility surface / mocked live background</span>
          </div>
          <span className="rounded-full border border-[rgba(80,210,193,0.24)] bg-[rgba(80,210,193,0.1)] px-3 py-1 text-[var(--landing-accent)]">
            Gesture-led scene
          </span>
        </div>

        <div
          aria-label="Interactive 3D volatility surface"
          className="relative aspect-[1.02/1] overflow-hidden sm:aspect-[1.45/1]"
          onClick={() => {
            setIsPinned((value) => !value);
            setZoomIndex((value) => clamp(value + 1, 0, 2));
          }}
          onDoubleClick={() => {
            setIsPinned(true);
            setZoomIndex(2);
          }}
          onMouseLeave={() => {
            setIsPinned(false);
          }}
          onMouseMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const nextX = (event.clientX - bounds.left) / bounds.width;
            const nextY = (event.clientY - bounds.top) / bounds.height;

            updatePointer(nextX, nextY);
            setOrbit({
              yaw: -37 + nextX * 10,
              pitch: 58 + nextY * 10,
            });
          }}
          onWheel={(event) => {
            event.preventDefault();

            setZoomIndex((value) => {
              const direction = event.deltaY > 0 ? -1 : 1;
              return clamp(value + direction, 0, 2);
            });
          }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_52%_52%,rgba(80,210,193,0.08),transparent_28%),radial-gradient(circle_at_56%_28%,rgba(136,182,255,0.08),transparent_24%)]" />

          <div className="absolute left-1/2 top-[12%] h-[62%] w-[72%] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(circle,rgba(80,210,193,0.12),transparent_70%)] blur-3xl" />

          <svg
            viewBox="0 0 1080 720"
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label="3D volatility surface with depth-based telemetry"
          >
            <title>3D volatility surface with depth-based telemetry</title>
            <defs>
              <linearGradient id="surface-grid" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(80,210,193,0.15)" />
                <stop offset="100%" stopColor="rgba(136,182,255,0.18)" />
              </linearGradient>
              <linearGradient id="surface-ribbon" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="rgba(80,210,193,0.06)" />
                <stop offset="50%" stopColor="rgba(80,210,193,0.24)" />
                <stop offset="100%" stopColor="rgba(80,210,193,0.06)" />
              </linearGradient>
            </defs>

            <ellipse cx="540" cy="560" rx="330" ry="72" fill="rgba(80,210,193,0.06)" />
            <ellipse cx="540" cy="548" rx="250" ry="48" fill="rgba(136,182,255,0.05)" />

            <path
              d="M 280 475 C 410 430, 650 398, 825 430"
              fill="none"
              opacity={mode === 'liquidity' ? 0.9 : 0.45}
              stroke="url(#surface-ribbon)"
              strokeWidth={mode === 'liquidity' ? 26 : 18}
            />
            <path
              d="M 320 338 C 470 292, 598 270, 750 304"
              fill="none"
              opacity={mode === 'term' ? 0.8 : 0.28}
              stroke="rgba(136,182,255,0.34)"
              strokeWidth={mode === 'term' ? 18 : 12}
            />

            {surface.horizontalLines.map((points, index) => (
              <polyline
                key={`h-${TENOR_LABELS[index]}`}
                fill="none"
                opacity={0.5 + index * 0.04}
                points={points}
                stroke="url(#surface-grid)"
                strokeWidth={detailLevel === 'overview' ? 1.4 : 1.8}
              />
            ))}

            {surface.verticalLines.map((points, index) => (
              <polyline
                key={`v-${STRIKE_LABELS[index]}`}
                fill="none"
                opacity={0.26 + (index % 3) * 0.08}
                points={points}
                stroke={mode === 'skew' ? 'rgba(251,191,36,0.24)' : 'rgba(148,163,184,0.22)'}
                strokeWidth={1.1}
              />
            ))}

            {surface.surfacePoints
              .slice()
              .sort((left, right) => left.depth - right.depth)
              .map((point) => {
                const isFocused = point.id === surface.focused.id;
                const isNearby = surface.nearbyPoints.some(
                  (nearbyPoint) => nearbyPoint.id === point.id,
                );
                const radius = isFocused ? 7 : isNearby ? 3.6 : 1.8;
                const opacity = isFocused
                  ? 1
                  : isNearby
                    ? 0.88
                    : detailLevel === 'overview'
                      ? 0.22
                      : 0.12;

                return (
                  <circle
                    key={point.id}
                    cx={point.screenX}
                    cy={point.screenY}
                    fill={getModeColor(mode, point)}
                    opacity={opacity}
                    r={radius}
                    stroke={isFocused ? 'rgba(237,244,246,0.9)' : 'transparent'}
                    strokeWidth={isFocused ? 1.2 : 0}
                  />
                );
              })}

            {detailLevel !== 'overview' ? (
              <>
                <line
                  x1={surface.focused.screenX}
                  x2={surface.focused.screenX + 58}
                  y1={surface.focused.screenY}
                  y2={surface.focused.screenY - 54}
                  stroke="rgba(237,244,246,0.72)"
                  strokeDasharray="3 5"
                  strokeWidth="1.2"
                />
                <circle
                  cx={surface.focused.screenX}
                  cy={surface.focused.screenY}
                  fill="transparent"
                  r={detailLevel === 'point' ? 18 : 13}
                  stroke="rgba(80,210,193,0.78)"
                  strokeWidth="1.4"
                />
              </>
            ) : null}
          </svg>

          <div className="landing-hud-panel absolute left-4 top-4 max-w-[16rem] sm:left-5 sm:top-5">
            <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--landing-accent)]">
              {detailCopy.title}
            </p>
            <p className="mt-3 text-sm leading-6 text-[var(--landing-text-strong)]">
              {detailCopy.description}
            </p>
            <div className="mt-4 grid gap-2 text-[11px] text-zinc-300">
              <div className="rounded-[1rem] border border-white/8 bg-black/16 px-3 py-2">
                <span className="font-[var(--font-mono)] uppercase tracking-[0.22em] text-zinc-500">
                  Overlay
                </span>
                <p className="mt-2 text-sm leading-5 text-zinc-200">{detailCopy.overlay}</p>
              </div>
              <div className="rounded-[1rem] border border-white/8 bg-black/16 px-3 py-2">
                <span className="font-[var(--font-mono)] uppercase tracking-[0.22em] text-zinc-500">
                  Telemetry
                </span>
                <p className="mt-2 text-sm leading-5 text-zinc-200">{detailCopy.telemetry}</p>
              </div>
            </div>
          </div>

          <div className="landing-hud-panel absolute right-4 top-4 w-[15rem] sm:right-5 sm:top-5">
            <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500">
              Scene modes
            </p>
            <div className="mt-3 grid gap-2">
              {MODES.map((sceneMode) => {
                const active = sceneMode.id === mode;

                return (
                  <button
                    key={sceneMode.id}
                    className={`flex items-center justify-between rounded-[1rem] border px-3 py-2 text-left transition ${
                      active
                        ? 'border-[rgba(80,210,193,0.38)] bg-[rgba(80,210,193,0.1)] text-[var(--landing-text-strong)]'
                        : 'border-white/8 bg-black/10 text-zinc-300 hover:border-white/14'
                    }`}
                    onClick={() => {
                      setMode(sceneMode.id);
                    }}
                    type="button"
                  >
                    <span>
                      <span className="block font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                        {sceneMode.label}
                      </span>
                      <span className="mt-1 block text-sm leading-5">{sceneMode.caption}</span>
                    </span>
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${active ? 'bg-[var(--landing-accent)]' : 'bg-zinc-600'}`}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="landing-hud-panel absolute bottom-4 left-4 right-4 sm:bottom-5 sm:left-5 sm:right-auto sm:w-[20rem]">
            <div className="flex flex-wrap gap-2">
              {DETAIL_LEVELS.map((level) => {
                const active = level.id === detailLevel;

                return (
                  <button
                    key={level.id}
                    className={`rounded-full border px-3 py-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] transition ${
                      active
                        ? 'border-[rgba(80,210,193,0.34)] bg-[rgba(80,210,193,0.1)] text-[var(--landing-accent)]'
                        : 'border-white/8 bg-black/12 text-zinc-400 hover:border-white/14'
                    }`}
                    onClick={() => {
                      setZoomIndex(DETAIL_INDEX_BY_LEVEL[level.id]);
                    }}
                    type="button"
                  >
                    {level.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              Orbit with pointer movement, use the wheel to dive through disclosure depth, and click
              to pin the active coordinate.
            </p>
          </div>

          <div
            className="landing-hud-panel pointer-events-none absolute min-w-[13rem] max-w-[15rem] transition duration-300"
            style={{
              left: `${(surface.focused.screenX / 1080) * 100}%`,
              top: `${(surface.focused.screenY / 720) * 100}%`,
              transform: 'translate(1.4rem, -5.6rem)',
            }}
          >
            <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--landing-accent)]">
              {surface.focused.strikeLabel} / {surface.focused.tenorLabel}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-zinc-200">
              <span>IV {surface.telemetry.liveIv}</span>
              <span>{surface.telemetry.skewShift}</span>
              <span>Spread {surface.telemetry.spread}</span>
              <span>Confidence {surface.telemetry.confidence}</span>
            </div>
            <p className="mt-3 text-sm leading-5 text-zinc-300">
              Liquidity {surface.telemetry.liquidity}. Tooltip stays anchored to the selected 3D
              coordinate.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
