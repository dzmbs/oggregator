"use client";

import dynamic from "next/dynamic";

import { surfaceStats } from "@/lib/demo-data";

import { SurfaceFallback } from "./three/SurfaceFallback";

const VolSurfaceCanvas = dynamic(() => import("./three/VolSurfaceCanvas"), {
  ssr: false,
  loading: () => <SurfaceFallback />,
});

export function VolSurfaceShowcase() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-24 sm:px-10">
      <div className="grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
        <div>
          <p className="mb-8 font-[var(--font-mono)] text-xs uppercase tracking-[0.45em] text-[var(--landing-accent)]">
            Volatility surface
          </p>
          <h2 className="max-w-xl font-[var(--font-heading)] text-5xl font-black leading-[0.92] tracking-[-0.06em] md:text-7xl">
            See the surface.
          </h2>
          <p className="mt-8 max-w-2xl text-lg leading-8 text-zinc-400">
            Visualize normalized implied volatility across tenor and delta
            without dropping the venue context that shapes the trade.
          </p>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
            The showcase mirrors how a desk scans wings, skew, and term
            structure before routing size.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {surfaceStats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-[1.6rem] border border-white/6 bg-[var(--landing-panel)] px-5 py-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)]"
              >
                <p className="font-[var(--font-mono)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
                  {stat.label}
                </p>
                <p className="mt-3 font-[var(--font-heading)] text-3xl font-black tracking-[-0.05em] text-[var(--landing-accent)]">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-[1.8rem] border border-white/6 bg-[var(--landing-panel-strong)] px-5 py-5 text-sm leading-7 text-zinc-400">
            Scan structure, not screenshots. The same surface can be extended
            with venue overlays, internal risk marks, and routing signals.
          </div>
        </div>

        <div className="rounded-[2.4rem] border border-white/6 bg-[var(--landing-panel)] p-4 shadow-[0_25px_80px_rgba(0,0,0,0.32)] sm:p-6">
          <div className="flex flex-col gap-3 border-b border-white/6 pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-[var(--font-mono)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
                BTC options surface
              </p>
              <p className="mt-2 text-sm text-zinc-400">
                Normalized IV by tenor and delta
              </p>
            </div>
            <p className="font-[var(--font-mono)] text-[11px] uppercase tracking-[0.34em] text-[var(--landing-accent)]">
              Desk preview
            </p>
          </div>

          <div className="mt-6">
            <VolSurfaceCanvas />
          </div>
        </div>
      </div>
    </section>
  );
}
