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
      <div className="mx-auto max-w-5xl text-center">
        <p className="mb-8 font-[var(--font-mono)] text-xs uppercase tracking-[0.45em] text-[var(--landing-accent)]">
          Rendering engine
        </p>
        <h2 className="font-[var(--font-heading)] text-5xl font-black leading-[0.92] tracking-[-0.06em] md:text-7xl">
          See the surface.
        </h2>
        <p className="mx-auto mt-8 max-w-4xl text-lg leading-8 text-zinc-400">
          Visualize IV across strike and tenor without losing the venue context
          that drives the trade.
        </p>
      </div>
      <div className="mt-12 rounded-[2.5rem] border border-white/6 bg-[var(--landing-panel)] p-8 shadow-[0_25px_80px_rgba(0,0,0,0.28)]">
        <div className="grid gap-6 border-b border-white/6 pb-8 md:grid-cols-4">
          {surfaceStats.map((stat) => (
            <div key={stat.label}>
              <p className="font-[var(--font-mono)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
                {stat.label}
              </p>
              <p className="mt-2 font-[var(--font-heading)] text-3xl font-black tracking-[-0.04em] text-[var(--landing-accent)]">
                {stat.value}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-8">
          <VolSurfaceCanvas />
        </div>
      </div>
    </section>
  );
}
