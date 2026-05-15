'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';

const APP_TABS = ['Chain', 'Portfolio', 'Volatility', 'Flow'] as const;
const VENUES = ['Deribit', 'OKX', 'Bybit', 'Binance', 'Derive', 'Coincall', 'Thalex'] as const;
const TRADE_TAPE = [
  'THX buy BTC 81k C sweep',
  'Deribit sell ETH 2.2k P clip',
  'Bybit lift BTC weekly wing',
  'Coincall block skew reset',
  'OKX buyers step into front gamma',
  'Binance call spread routed',
] as const;

interface SurfacePoint {
  x: number;
  y: number;
}

interface SurfaceState {
  horizontalLines: string[];
  verticalLines: string[];
  pulseX: number;
  pulseY: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildSurfaceLines(phase: number, drift: number, pulseSeed: number): SurfaceState {
  const rows = 13;
  const columns = 18;
  const horizontalLines: string[] = [];
  const verticalLines: string[] = [];
  const pulseX = 280 + Math.sin(pulseSeed * 1.7) * 140;
  const pulseY = 176 + Math.cos(pulseSeed * 1.2) * 58;

  for (let row = 0; row < rows; row += 1) {
    const points: SurfacePoint[] = [];
    const yRatio = row / (rows - 1);

    for (let column = 0; column < columns; column += 1) {
      const xRatio = column / (columns - 1);
      const baseX = 70 + xRatio * 500;
      const wave = Math.sin(phase + xRatio * 4.6 + yRatio * 2.4) * 18;
      const skew = Math.cos(phase * 0.66 + yRatio * 2.2) * (xRatio - 0.5) * 52;
      const hump = Math.exp(-((xRatio - 0.58) ** 2) / 0.02) * (18 + yRatio * 24);
      const pulse =
        Math.exp(-((baseX - pulseX) ** 2) / 20000) * Math.exp(-((yRatio - 0.35) ** 2) / 0.05) * 26;
      const y = 322 - yRatio * 156 - wave - skew - hump - pulse - drift * 8;

      points.push({ x: baseX, y });
    }

    horizontalLines.push(
      points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '),
    );
  }

  for (let column = 0; column < columns; column += 1) {
    const points: SurfacePoint[] = [];
    const xRatio = column / (columns - 1);

    for (let row = 0; row < rows; row += 1) {
      const yRatio = row / (rows - 1);
      const baseX = 70 + xRatio * 500;
      const wave = Math.sin(phase + xRatio * 4.6 + yRatio * 2.4) * 18;
      const skew = Math.cos(phase * 0.66 + yRatio * 2.2) * (xRatio - 0.5) * 52;
      const hump = Math.exp(-((xRatio - 0.58) ** 2) / 0.02) * (18 + yRatio * 24);
      const pulse =
        Math.exp(-((baseX - pulseX) ** 2) / 20000) * Math.exp(-((yRatio - 0.35) ** 2) / 0.05) * 26;
      const y = 322 - yRatio * 156 - wave - skew - hump - pulse - drift * 8;

      points.push({ x: baseX, y });
    }

    verticalLines.push(
      points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '),
    );
  }

  return { horizontalLines, verticalLines, pulseX, pulseY };
}

export function VolatilitySurfaceExperience() {
  const [phase, setPhase] = useState<number>(0);
  const [drift, setDrift] = useState<number>(0);
  const [pulseSeed, setPulseSeed] = useState<number>(0.8);
  const [activeTab, setActiveTab] = useState<(typeof APP_TABS)[number]>('Volatility');

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhase((value) => value + 0.24);
      setDrift((value) => clamp(value + (Math.random() - 0.5) * 0.16, -1.2, 1.2));
      setPulseSeed((value) => value + 0.18 + Math.random() * 0.14);
    }, 900);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const surface = useMemo(
    () => buildSurfaceLines(phase, drift, pulseSeed),
    [drift, phase, pulseSeed],
  );
  const doubledTape = [...TRADE_TAPE, ...TRADE_TAPE];

  return (
    <div className="landing-surface-shell relative overflow-hidden rounded-[2rem] border border-[color:var(--landing-border-strong)] bg-[rgba(6,9,12,0.92)] p-3 shadow-[0_40px_140px_rgba(0,0,0,0.5)] sm:p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(80,210,193,0.14),transparent_28%),radial-gradient(circle_at_86%_12%,rgba(90,125,255,0.1),transparent_24%)]" />

      <div className="relative overflow-hidden rounded-[1.6rem] border border-white/8 bg-[#090b0d]">
        <div className="border-b border-white/8 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {APP_TABS.map((tab) => {
                const active = tab === activeTab;

                return (
                  <button
                    key={tab}
                    className={`rounded-[0.8rem] border px-3 py-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] transition ${
                      active
                        ? 'border-[rgba(80,210,193,0.45)] bg-[rgba(80,210,193,0.12)] text-[var(--landing-text-strong)]'
                        : 'border-white/8 bg-[#0d1014] text-zinc-500 hover:border-white/14'
                    }`}
                    onClick={() => setActiveTab(tab)}
                    type="button"
                  >
                    {tab}
                    {tab === 'Flow' ? (
                      <span className="ml-2 text-[var(--landing-accent)]">Live</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-zinc-500">
              <span className="rounded-full border border-white/8 bg-[#0d1014] px-3 py-2">
                acct acct_exec
              </span>
              <span className="rounded-full border border-[rgba(80,210,193,0.26)] bg-[rgba(80,210,193,0.08)] px-3 py-2 text-[var(--landing-accent)]">
                simulated live surface
              </span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            {VENUES.map((venue, index) => (
              <span
                key={venue}
                className={`rounded-full border border-white/8 px-2.5 py-1.5 ${index === 6 ? 'bg-[rgba(80,210,193,0.12)] text-[var(--landing-accent)]' : 'bg-[#0d1014]'}`}
              >
                {venue}
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-3 p-3 lg:grid-cols-[1.25fr_0.75fr] lg:p-4">
          <div className="overflow-hidden rounded-[1.35rem] border border-white/8 bg-[linear-gradient(180deg,#101317,#090b0d)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
              <div>
                <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--landing-accent)]">
                  3D IV surface
                </p>
                <p className="mt-2 text-sm text-zinc-400">
                  Same volatility architecture as the app, but motion-only on landing.
                </p>
              </div>
              <div className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                No market payload, only live behavior simulation
              </div>
            </div>

            <div
              aria-label="Interactive 3D volatility surface"
              className="relative aspect-[1.32/1] overflow-hidden bg-[radial-gradient(circle_at_50%_10%,rgba(80,210,193,0.08),transparent_30%),linear-gradient(180deg,rgba(12,15,19,0.98),rgba(8,10,12,0.96))]"
            >
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.22))]" />
              <svg
                viewBox="0 0 640 430"
                className="absolute inset-0 h-full w-full"
                role="img"
                aria-label="Simulated live volatility surface inspired by the app view"
              >
                <title>Simulated live volatility surface inspired by the app view</title>
                <defs>
                  <linearGradient id="surface-main" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgba(45,90,255,0.52)" />
                    <stop offset="52%" stopColor="rgba(117,229,215,0.58)" />
                    <stop offset="100%" stopColor="rgba(255,169,85,0.46)" />
                  </linearGradient>
                </defs>

                <ellipse cx="322" cy="338" rx="256" ry="42" fill="rgba(80,210,193,0.05)" />

                <line
                  x1="70"
                  x2="572"
                  y1="340"
                  y2="340"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="1"
                />
                <line
                  x1="70"
                  x2="70"
                  y1="146"
                  y2="340"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="1"
                />
                <line
                  x1="70"
                  x2="142"
                  y1="340"
                  y2="100"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="1"
                />

                {surface.horizontalLines.map((points, index) => (
                  <polyline
                    key={`h-${index}`}
                    fill="none"
                    opacity={0.26 + index * 0.03}
                    points={points}
                    stroke="url(#surface-main)"
                    strokeWidth={index === 5 || index === 6 ? 1.8 : 1.15}
                  />
                ))}

                {surface.verticalLines.map((points, index) => (
                  <polyline
                    key={`v-${index}`}
                    fill="none"
                    opacity={0.15 + (index % 4) * 0.04}
                    points={points}
                    stroke="rgba(200,214,255,0.34)"
                    strokeWidth={1}
                  />
                ))}

                <circle
                  cx={surface.pulseX}
                  cy={surface.pulseY}
                  r="11"
                  fill="rgba(80,210,193,0.22)"
                />
                <circle
                  cx={surface.pulseX}
                  cy={surface.pulseY}
                  r="4"
                  fill="rgba(237,244,246,0.9)"
                />
              </svg>

              <div className="landing-hud-panel pointer-events-none absolute left-4 top-4 max-w-[14rem]">
                <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--landing-accent)]">
                  Motion model
                </p>
                <p className="mt-3 text-sm leading-6 text-zinc-200">
                  Surface breathes, tilts, and pulses like live prices without exposing fake quotes.
                </p>
              </div>

              <div className="landing-hud-panel pointer-events-none absolute bottom-4 left-4 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                delta axis / tenor axis / IV axis
              </div>

              <div className="landing-hud-panel pointer-events-none absolute right-4 top-4 max-w-[13rem]">
                <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                  App parity
                </p>
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  Same surface-first composition, same dark terminal language, same feed-forward
                  feel.
                </p>
              </div>
            </div>

            <div className="border-t border-white/8 px-3 py-3 sm:px-4">
              <div className="landing-feed-tape overflow-hidden rounded-[1rem] border border-white/8 bg-[#0b0d10] px-3 py-2">
                <div className="landing-feed-tape-track flex min-w-max items-center gap-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.18em] text-zinc-300">
                  {doubledTape.map((item, index) => (
                    <span
                      key={`${item}-${index}`}
                      className="rounded-full border border-white/8 bg-[#101317] px-3 py-1.5"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            <article className="overflow-hidden rounded-[1.35rem] border border-white/8 bg-[#0d1014]">
              <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                <div>
                  <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--landing-accent)]">
                    Portfolio preview
                  </p>
                  <p className="mt-2 text-sm text-zinc-400">
                    Real app capture from the portfolio workspace.
                  </p>
                </div>
              </div>
              <div className="p-3">
                <div className="relative aspect-[1.65/1] overflow-hidden rounded-[1rem] border border-white/8 bg-black">
                  <Image
                    src="/portfolio1.png"
                    alt="Portfolio workspace screenshot from the live app."
                    fill
                    priority
                    sizes="(min-width: 1024px) 28vw, 100vw"
                    className="object-cover object-[48%_14%] scale-[1.08]"
                  />
                </div>
              </div>
            </article>

            <article className="overflow-hidden rounded-[1.35rem] border border-white/8 bg-[#0d1014]">
              <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                <div>
                  <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--landing-accent)]">
                    Chain preview
                  </p>
                  <p className="mt-2 text-sm text-zinc-400">
                    Real chain view capture matching the terminal styling.
                  </p>
                </div>
              </div>
              <div className="p-3">
                <div className="relative aspect-[1.65/1] overflow-hidden rounded-[1rem] border border-white/8 bg-black">
                  <Image
                    src="/chainview.png"
                    alt="Chain workspace screenshot from the live app."
                    fill
                    sizes="(min-width: 1024px) 28vw, 100vw"
                    className="object-cover object-[50%_18%] scale-[1.06]"
                  />
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}
