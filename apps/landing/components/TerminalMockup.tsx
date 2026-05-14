import {
  commandSequence,
  routeCandidates,
  terminalMetrics,
  terminalRows,
} from "@/lib/demo-data";

const statusToneClass = {
  primary:
    "border border-[rgba(80,210,193,0.22)] bg-[rgba(80,210,193,0.12)] text-[var(--landing-accent)]",
  secondary: "border border-white/8 bg-white/6 text-zinc-300",
} as const;

const sparklineHeights = [42, 68, 58, 76, 54, 83, 72, 90] as const;

export function TerminalMockup() {
  return (
    <div className="landing-panel-strong relative overflow-hidden rounded-[2rem] p-4 sm:p-5">
      <div className="absolute inset-x-10 top-0 h-32 bg-[radial-gradient(circle,_rgba(80,210,193,0.18),_transparent_72%)] blur-3xl" />
      <div className="relative overflow-hidden rounded-[1.6rem] border border-[color:var(--landing-border)] bg-[rgba(10,10,10,0.96)] shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--landing-border)] px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--landing-loss)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--landing-warning)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--landing-success)]" />
            </div>
            <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.28em] text-zinc-400">
              Oggregator terminal / live route stack
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[rgba(80,210,193,0.2)] bg-[rgba(80,210,193,0.1)] px-3 py-1 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--landing-accent)]">
              Sync nominal
            </span>
            <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-300">
              Strategy view
            </span>
          </div>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-[1.18fr_0.82fr] sm:p-5">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {terminalMetrics.map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-[1.15rem] border border-[color:var(--landing-border)] bg-white/[0.03] px-4 py-3"
                >
                  <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                    {metric.label}
                  </p>
                  <p
                    className={`mt-2 font-[var(--font-heading)] text-2xl font-black tracking-[-0.05em] ${
                      metric.tone === "accent"
                        ? "text-[var(--landing-accent)]"
                        : "text-[var(--landing-text)]"
                    }`}
                  >
                    {metric.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="rounded-[1.4rem] border border-[color:var(--landing-border)] bg-white/[0.025] p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                    Aggregate chain
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">
                    Normalized cross-venue options context
                  </p>
                </div>
                <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-300">
                  Best route visible
                </span>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-[1.8fr_0.7fr_0.6fr_0.8fr_0.8fr] gap-3 px-3 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                  <span>Instrument</span>
                  <span>Mid IV</span>
                  <span>Skew</span>
                  <span>Venue</span>
                  <span>Edge</span>
                </div>
                {terminalRows.map((row) => (
                  <div
                    key={row.symbol}
                    className="grid grid-cols-[1.8fr_0.7fr_0.6fr_0.8fr_0.8fr] gap-3 rounded-[1rem] border border-white/6 bg-black/20 px-3 py-3 text-sm text-zinc-200 transition duration-300 hover:border-[rgba(80,210,193,0.3)] hover:bg-white/[0.05]"
                  >
                    <span className="truncate font-[var(--font-mono)] text-[11px] text-zinc-100">
                      {row.symbol}
                    </span>
                    <span>{row.midIv}</span>
                    <span>{row.skew}</span>
                    <span className="text-zinc-400">{row.venue}</span>
                    <span className="text-[var(--landing-success)]">{row.edge}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[1.4rem] border border-[color:var(--landing-border)] bg-[linear-gradient(180deg,rgba(80,210,193,0.08),rgba(255,255,255,0.02))] p-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                    Route summary
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">
                    Executable venue confidence and transport cost
                  </p>
                </div>
                <p className="font-[var(--font-heading)] text-3xl font-black tracking-[-0.05em] text-[var(--landing-accent)]">
                  +14 bps
                </p>
              </div>

              <div className="mt-4 space-y-3">
                {routeCandidates.map((candidate) => (
                  <div
                    key={candidate.venue}
                    className="rounded-[1rem] border border-white/6 bg-black/20 px-3 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-[var(--font-mono)] text-[11px] uppercase tracking-[0.24em] text-zinc-200">
                        {candidate.venue}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.2em] ${statusToneClass[candidate.status]}`}
                      >
                        {candidate.status}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-sm text-zinc-400">
                      <span>Projected fill {candidate.fill}</span>
                      <span>{candidate.latency}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_0.84fr] lg:grid-cols-1 xl:grid-cols-[1fr_0.84fr]">
              <div className="rounded-[1.4rem] border border-[color:var(--landing-border)] bg-white/[0.025] p-4">
                <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                  Command stack
                </p>
                <div className="mt-4 space-y-2 font-[var(--font-mono)] text-[11px] leading-6 text-zinc-300">
                  {commandSequence.map((command, index) => (
                    <div key={command} className="flex gap-3 rounded-[0.9rem] bg-black/20 px-3 py-2">
                      <span className="text-zinc-500">0{index + 1}</span>
                      <span>{command}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.4rem] border border-[color:var(--landing-border)] bg-white/[0.025] p-4">
                <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                  Surface preview
                </p>
                <div className="mt-4 flex h-[168px] items-end gap-2 rounded-[1rem] border border-white/6 bg-[linear-gradient(180deg,rgba(136,182,255,0.14),rgba(10,10,10,0.1))] px-3 pb-3 pt-6">
                  {sparklineHeights.map((height) => (
                    <div key={height} className="flex-1 rounded-full bg-white/6 p-[1px]">
                      <div
                        className="w-full rounded-full bg-[linear-gradient(180deg,var(--landing-accent),var(--landing-accent-violet))]"
                        style={{ height }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
