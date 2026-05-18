"use client";

import { useState } from "react";

import { landingCopy } from "@/lib/copy";
import { venues } from "@/lib/demo-data";

function VenueLogo({ slug, name }: { slug: string; name: string }) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <span className="font-[var(--font-heading)] text-base uppercase tracking-[0.18em] text-[var(--landing-muted-strong)] transition group-hover:text-[var(--landing-text-strong)]">
        {name}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/venues/${slug}.svg`}
      alt={name}
      onError={() => setErrored(true)}
      className="h-7 w-auto opacity-70 grayscale brightness-200 transition group-hover:opacity-100 sm:h-8"
    />
  );
}

export function VenueStrip() {
  return (
    <section
      id="venues"
      aria-label={landingCopy.venues.title}
      className="landing-container px-6 py-16 sm:px-10 sm:py-20"
    >
      <div className="flex flex-col items-start gap-3 border-t border-white/8 pt-10 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
        <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-[var(--landing-accent)]">
          ◢ {landingCopy.venues.eyebrow.toLowerCase()}
        </p>
        <p className="max-w-md font-[var(--font-heading)] text-[clamp(1.4rem,2.4vw,2rem)] font-medium leading-[1.05] tracking-[-0.03em] text-[var(--landing-text-strong)]">
          {landingCopy.venues.title}
        </p>
      </div>

      <ul className="mt-10 grid grid-cols-2 items-center gap-x-8 gap-y-10 sm:grid-cols-4 lg:grid-cols-8">
        {venues.map((venue) => (
          <li
            key={venue.slug}
            className="group flex items-center justify-center"
          >
            <VenueLogo slug={venue.slug} name={venue.name} />
          </li>
        ))}
      </ul>
    </section>
  );
}
