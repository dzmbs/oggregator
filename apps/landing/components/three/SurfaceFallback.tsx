export function SurfaceFallback() {
  return (
    <div className="flex h-[28rem] items-center justify-center rounded-[1.75rem] bg-[radial-gradient(circle_at_22%_22%,_rgba(215,122,82,0.18),_transparent_30%),_radial-gradient(circle_at_78%_28%,_rgba(255,255,255,0.08),_transparent_26%),_#0d0e11]">
      <div className="grid h-56 w-[85%] place-items-center rounded-[1.5rem] border border-white/8 bg-[linear-gradient(180deg,_rgba(255,255,255,0.04),_rgba(255,255,255,0.01))]">
        <p className="font-[var(--font-mono)] text-sm uppercase tracking-[0.35em] text-zinc-500">
          Volatility surface preview
        </p>
      </div>
    </div>
  );
}
