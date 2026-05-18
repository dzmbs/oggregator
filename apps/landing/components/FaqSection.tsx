"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";

import { faqItems } from "@/lib/demo-data";
import { landingCopy } from "@/lib/copy";

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number>(0);
  const prefersReducedMotion = useReducedMotion();

  return (
    <section
      id="faq"
      className="landing-container relative px-6 py-24 sm:px-10 sm:py-32"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent sm:inset-x-10"
      />

      <div className="grid gap-14 lg:grid-cols-[0.42fr_0.58fr] lg:gap-20">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="flex items-baseline gap-3">
            <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-[var(--landing-accent)]">
              ◢ {landingCopy.faq.eyebrow.toLowerCase()}
            </span>
            <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-zinc-600">
              06 entries
            </span>
          </div>
          <h2 className="mt-7 font-[var(--font-heading)] text-[clamp(2.6rem,5vw,4.6rem)] font-medium leading-[0.94] tracking-[-0.05em] text-[var(--landing-text-strong)]">
            {landingCopy.faq.title}
          </h2>
          <p className="mt-7 max-w-md text-base leading-7 text-[var(--landing-muted-strong)]">
            {landingCopy.faq.description}
          </p>

          <dl className="mt-10 grid max-w-md grid-cols-2 gap-x-6 gap-y-4 border-t border-white/8 pt-6 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.28em]">
            <div>
              <dt className="text-zinc-600">Latency budget</dt>
              <dd className="mt-2 text-[var(--landing-text-strong)]">420 ms</dd>
            </div>
            <div>
              <dt className="text-zinc-600">Feed health</dt>
              <dd className="mt-2 text-[var(--landing-text-strong)]">99.98%</dd>
            </div>
            <div>
              <dt className="text-zinc-600">Venues</dt>
              <dd className="mt-2 text-[var(--landing-text-strong)]">07 wired</dd>
            </div>
            <div>
              <dt className="text-zinc-600">Refresh</dt>
              <dd className="mt-2 text-[var(--landing-text-strong)]">sub-second</dd>
            </div>
          </dl>
        </div>

        <ol className="-mt-2 list-none">
          {faqItems.map((item, index) => {
            const isOpen = openIndex === index;
            const panelId = `faq-panel-${index}`;
            const buttonId = `faq-button-${index}`;

            return (
              <li
                key={item.question}
                className={
                  index === 0
                    ? "border-t border-white/10"
                    : "border-t border-white/[0.06]"
                }
              >
                <h3>
                  <button
                    id={buttonId}
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenIndex(isOpen ? -1 : index)}
                    className="group relative flex w-full items-start gap-6 py-7 text-left transition sm:py-9"
                  >
                    <span className="pt-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.32em] text-zinc-500 transition-colors group-hover:text-[var(--landing-accent)]">
                      {`0${index + 1}`.slice(-2)}
                    </span>

                    <span className="flex-1 font-[var(--font-heading)] text-[clamp(1.35rem,2.4vw,2rem)] font-medium leading-[1.08] tracking-[-0.035em] text-[var(--landing-text-strong)] transition-colors group-hover:text-white">
                      {item.question}
                    </span>

                    <span
                      aria-hidden
                      className="relative mt-3 flex h-3 w-6 shrink-0 items-center justify-center"
                    >
                      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--landing-accent)]" />
                      <span
                        className={
                          "absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-[var(--landing-accent)] transition-transform duration-300 " +
                          (isOpen ? "scale-y-0" : "scale-y-100")
                        }
                      />
                    </span>
                  </button>
                </h3>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.section
                      id={panelId}
                      aria-labelledby={buttonId}
                      key={`panel-${index}`}
                      initial={
                        prefersReducedMotion
                          ? { opacity: 1, height: "auto" }
                          : { opacity: 0, height: 0 }
                      }
                      animate={{ opacity: 1, height: "auto" }}
                      exit={
                        prefersReducedMotion
                          ? { opacity: 0 }
                          : { opacity: 0, height: 0 }
                      }
                      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-[auto_1fr] gap-6 pb-8 sm:pb-10">
                        <span aria-hidden className="w-[18px]" />
                        <div className="max-w-2xl">
                          <p className="text-[1.05rem] leading-8 text-[var(--landing-muted-strong)]">
                            {item.answer}
                          </p>
                          <div className="mt-5 flex items-center gap-3 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                            <span className="h-[6px] w-[6px] rotate-45 bg-[var(--landing-accent)]" />
                            <span>answered by the desk doc</span>
                          </div>
                        </div>
                      </div>
                    </motion.section>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
          <li className="border-t border-white/10" />
        </ol>
      </div>
    </section>
  );
}
