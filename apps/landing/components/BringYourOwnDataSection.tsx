import { dataSnippet } from "@/lib/demo-data";

export function BringYourOwnDataSection() {
  return (
    <section className="mx-auto grid max-w-7xl gap-12 px-6 py-24 sm:px-10 lg:grid-cols-[1fr_1fr]">
      <div className="rounded-[2.4rem] border border-white/6 bg-[var(--landing-panel-strong)] p-10 shadow-[0_25px_80px_rgba(0,0,0,0.34)]">
        <p className="mb-8 font-[var(--font-mono)] text-xs uppercase tracking-[0.45em] text-zinc-500">
          feed-adapter.ts
        </p>
        <pre className="overflow-x-auto font-[var(--font-mono)] text-sm leading-8 text-zinc-300">
          <code>{dataSnippet.join("\n")}</code>
        </pre>
      </div>
      <div>
        <p className="mb-8 font-[var(--font-mono)] text-xs uppercase tracking-[0.45em] text-[var(--landing-accent)]">
          Flexible integration
        </p>
        <h2 className="font-[var(--font-heading)] text-5xl font-black leading-[0.92] tracking-[-0.06em] md:text-7xl">
          Bring your own data.
        </h2>
        <p className="mt-8 max-w-2xl text-lg leading-8 text-zinc-400">
          Plug proprietary venue snapshots, risk overlays, and internal signals
          into the same options routing workflow.
        </p>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
          Keep your pipeline. Let Oggregator provide the context layer.
        </p>
      </div>
    </section>
  );
}
