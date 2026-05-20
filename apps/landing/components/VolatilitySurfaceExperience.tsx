'use client';

import Image from 'next/image';
import dynamic from 'next/dynamic';
import { useMemo } from 'react';

const LandingSurfacePlot = dynamic(
  () => import('./LandingSurfacePlot').then((module) => module.LandingSurfacePlot),
  {
    ssr: false,
    loading: () => (
      <div
        aria-label="Interactive 3D volatility surface"
        className="flex h-full min-h-[420px] items-center justify-center font-[var(--font-mono)] text-[11px] uppercase tracking-[0.24em] text-zinc-500"
      >
        Loading 3D IV surface...
      </div>
    ),
  },
);

const HERO_TABS = [
  'CHAIN',
  'ALPHA',
  'BUILDER',
  'PAPER',
  'PORTFOLIO',
  'VOLATILITY',
  'FLOW',
  'ANALYTICS',
  'GEX',
] as const;
const HERO_EXPIRIES = [
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
const TAPE_ITEMS = [
  'Thalex buy BTC 81k call sweep',
  'Deribit front skew reprices higher',
  'OKX wings firm on block flow',
  'Coincall routed spread fills',
  'Bybit weekly gamma changes hands',
  'Derive risk transfer prints',
] as const;

export function VolatilitySurfaceExperience() {
  const doubledTape = useMemo(() => [...TAPE_ITEMS, ...TAPE_ITEMS], []);

  return (
    <div className="landing-surface-shell relative overflow-hidden rounded-[2rem] border border-[color:var(--landing-border-strong)] bg-[rgba(6,9,12,0.94)] p-2 shadow-[0_40px_140px_rgba(0,0,0,0.5)] sm:p-3">
      <div className="relative overflow-hidden rounded-[1.7rem] border border-white/8 bg-[#090b0d]">
        <div className="border-b border-white/8 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <div className="font-[var(--font-heading)] text-[1.15rem] font-semibold italic leading-none text-[var(--landing-text-strong)]">
                <span className="text-[#ff4d4d]">0</span> Theta
                <br />
                Oggregator
              </div>
              <div className="hidden flex-wrap items-center gap-2 lg:flex">
                {HERO_TABS.map((tab) => (
                  <span
                    key={tab}
                    className={`rounded-[0.8rem] border px-3 py-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] ${
                      tab === 'VOLATILITY'
                        ? 'border-[rgba(80,210,193,0.4)] bg-[rgba(80,210,193,0.1)] text-[var(--landing-text-strong)]'
                        : 'border-white/8 bg-[#0d1014] text-zinc-500'
                    }`}
                  >
                    {tab}
                    {tab === 'FLOW' ? (
                      <span className="ml-2 text-[var(--landing-accent)]">LIVE</span>
                    ) : null}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              <span className="rounded-full border border-white/8 bg-[#0d1014] px-3 py-2">
                odte 07:49:02
              </span>
              <span className="rounded-full border border-white/8 bg-[#0d1014] px-3 py-2">
                <span className="mr-2 text-[var(--landing-accent)]">●●●●●●●●</span>5792625ms
              </span>
            </div>
          </div>
        </div>

        <div className="border-b border-white/8 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <span className="rounded-[0.8rem] border border-[rgba(80,210,193,0.42)] bg-[rgba(80,210,193,0.1)] px-3 py-2 text-[var(--landing-text-strong)]">
              BTC $81.3K <span className="text-[var(--landing-accent)]">+2.3%</span>
            </span>
            {HERO_EXPIRIES.map((expiry, index) => (
              <span
                key={expiry}
                className={`rounded-[0.7rem] border px-2.5 py-1.5 ${
                  index === 0
                    ? 'border-[rgba(80,210,193,0.34)] text-[var(--landing-text-strong)]'
                    : 'border-white/8 bg-[#0d1014]'
                }`}
              >
                {expiry}
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-3 p-3 xl:grid-cols-[1.45fr_0.9fr] xl:p-4">
          <section className="overflow-hidden rounded-[1.35rem] border border-white/8 bg-[#0d1014]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
              <div className="flex items-center gap-2">
                <h3 className="font-[var(--font-mono)] text-base font-semibold uppercase tracking-[0.12em] text-[var(--landing-text-strong)]">
                  3D IV Surface
                </h3>
                <span className="rounded-full border border-white/8 px-2 py-1 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                  BTC
                </span>
                <span className="rounded-full border border-white/8 px-2 py-1 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                  Average
                </span>
                <span className="rounded-full border border-white/8 px-2 py-1 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                  Listed
                </span>
              </div>

              <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                mocked motion, real app rendering style
              </span>
            </div>

            <div
              aria-label="Interactive 3D volatility surface"
              className="h-[460px] bg-black px-3 py-3 sm:px-4 sm:py-4"
            >
              <LandingSurfacePlot />
            </div>
          </section>

          <div className="grid gap-3">
            <article className="overflow-hidden rounded-[1.35rem] border border-white/8 bg-[#0d1014]">
              <div className="border-b border-white/8 px-4 py-3">
                <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--landing-accent)]">
                  Portfolio preview
                </p>
                <p className="mt-2 text-sm text-zinc-400">
                  Real app capture from the portfolio workspace.
                </p>
              </div>
              <div className="p-3">
                <div className="relative aspect-[1.68/1] overflow-hidden rounded-[1rem] border border-white/8 bg-black">
                  <Image
                    src="/portfolio1.png"
                    alt="Portfolio workspace screenshot from the live app."
                    fill
                    priority
                    sizes="(min-width: 1280px) 30vw, 100vw"
                    className="object-cover object-[50%_14%] scale-[1.04]"
                  />
                </div>
              </div>
            </article>

            <article className="overflow-hidden rounded-[1.35rem] border border-white/8 bg-[#0d1014]">
              <div className="border-b border-white/8 px-4 py-3">
                <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--landing-accent)]">
                  Chain preview
                </p>
                <p className="mt-2 text-sm text-zinc-400">
                  Real chain capture matching the production terminal shell.
                </p>
              </div>
              <div className="p-3">
                <div className="relative aspect-[1.68/1] overflow-hidden rounded-[1rem] border border-white/8 bg-black">
                  <Image
                    src="/chainview.png"
                    alt="Chain workspace screenshot from the live app."
                    fill
                    sizes="(min-width: 1280px) 30vw, 100vw"
                    className="object-cover object-[50%_18%] scale-[1.03]"
                  />
                </div>
              </div>
            </article>
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
    </div>
  );
}
