import { testimonials } from "@/lib/demo-data";

export function TestimonialsGrid() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-24 sm:px-10">
      <div className="grid gap-6 lg:grid-cols-3">
        {testimonials.map((item) => (
          <article
            key={`${item.company}-${item.person}`}
            className="rounded-[2rem] border border-white/6 bg-[var(--landing-panel)] p-8 shadow-[0_20px_60px_rgba(0,0,0,0.22)]"
          >
            <p className="text-lg font-semibold italic leading-9 text-zinc-200">
              {item.quote}
            </p>
            <p className="mt-10 font-[var(--font-mono)] text-xs uppercase tracking-[0.34em] text-zinc-500">
              {item.person} · {item.company}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
