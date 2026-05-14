"use client";

import { useState } from "react";

import { faqItems } from "@/lib/demo-data";
import { landingCopy } from "@/lib/copy";

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number>(0);

  return (
    <section id="faq" className="landing-container px-6 py-20 sm:px-10 sm:py-24">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-12">
        <div className="max-w-xl">
          <p className="landing-kicker">{landingCopy.faq.eyebrow}</p>
          <h2 className="landing-section-title mt-4 max-w-[12ch]">{landingCopy.faq.title}</h2>
          <p className="landing-section-copy mt-6">{landingCopy.faq.description}</p>
        </div>

        <div className="space-y-3">
          {faqItems.map((item, index) => {
            const isOpen = openIndex === index;
            const panelId = `faq-panel-${index}`;
            const buttonId = `faq-button-${index}`;

            return (
              <article key={item.question} className="landing-panel overflow-hidden rounded-[1.5rem]">
                <h3>
                  <button
                    id={buttonId}
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenIndex(isOpen ? -1 : index)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left transition hover:bg-white/[0.02] sm:px-6"
                  >
                    <div className="flex items-center gap-4">
                      <span className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-zinc-400">
                        0{index + 1}
                      </span>
                      <span className="font-[var(--font-heading)] text-lg font-medium tracking-[-0.03em] text-[var(--landing-text-strong)]">
                        {item.question}
                      </span>
                    </div>
                    <span className="font-[var(--font-mono)] text-lg text-[var(--landing-accent)]">
                      {isOpen ? "-" : "+"}
                    </span>
                  </button>
                </h3>

                <section
                  id={panelId}
                  aria-labelledby={buttonId}
                  className={isOpen ? "block px-5 pb-5 sm:px-6 sm:pb-6" : "hidden px-5 pb-5 sm:px-6 sm:pb-6"}
                >
                  <p className="max-w-3xl text-base leading-7 text-[var(--landing-muted-strong)]">
                    {item.answer}
                  </p>
                </section>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
