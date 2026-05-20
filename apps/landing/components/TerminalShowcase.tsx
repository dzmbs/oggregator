"use client";

import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
  type MotionValue,
} from "framer-motion";
import Image from "next/image";
import { useRef, useState } from "react";

import { landingCopy } from "@/lib/copy";
import { showcaseFrames, type ShowcaseFrame } from "@/lib/demo-data";

const FRAME_WINDOW = 0.85;

function FramePlate({ frame, priority }: { frame: ShowcaseFrame; priority: boolean }) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_50%_30%,_rgba(237,244,246,0.08),_transparent_55%),_#0a0d10] text-center">
        <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-[var(--landing-accent)]">
          {frame.eyebrow}
        </span>
        <span className="max-w-md px-6 font-[var(--font-heading)] text-2xl font-medium tracking-[-0.02em] text-[var(--landing-text-strong)]">
          {frame.title}
        </span>
        <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
          drop image at <code>apps/landing/public{frame.src}</code>
        </span>
      </div>
    );
  }

  return (
    <Image
      src={frame.src}
      alt={frame.title}
      fill
      sizes="(min-width: 1024px) 60vw, 100vw"
      className="object-contain"
      priority={priority}
      onError={() => setErrored(true)}
    />
  );
}

function Frame({
  frame,
  index,
  total,
  progress,
}: {
  frame: ShowcaseFrame;
  index: number;
  total: number;
  progress: MotionValue<number>;
}) {
  const slice = 1 / total;
  const center = (index + 0.5) * slice;
  const window = slice * FRAME_WINDOW;

  const opacity = useTransform(progress, (value) => {
    const distance = Math.abs(value - center);
    if (distance > window) return 0;
    return 1 - distance / window;
  });

  const scale = useTransform(progress, (value) => {
    const distance = (value - center) / slice;
    return 1 - Math.min(Math.abs(distance), 1) * 0.04;
  });

  const y = useTransform(progress, (value) => (value - center) * 70);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center px-6 sm:px-10"
      style={{ opacity, scale, y }}
    >
      <div className="relative aspect-[16/10] w-full max-w-5xl overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/40 shadow-[0_30px_90px_-40px_rgba(0,0,0,0.9)]">
        <FramePlate frame={frame} priority={index === 0} />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(8,11,13,0.0)_60%,rgba(8,11,13,0.6)_100%)]"
        />
      </div>
    </motion.div>
  );
}

function FrameCaption({
  frame,
  index,
  total,
  progress,
}: {
  frame: ShowcaseFrame;
  index: number;
  total: number;
  progress: MotionValue<number>;
}) {
  const slice = 1 / total;
  const center = (index + 0.5) * slice;
  const window = slice * 0.6;

  const opacity = useTransform(progress, (value) => {
    const distance = Math.abs(value - center);
    if (distance > window) return 0;
    return 1 - distance / window;
  });

  const y = useTransform(progress, (value) => (value - center) * -40);

  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 bottom-10 flex justify-center px-6 sm:px-10"
      style={{ opacity, y }}
    >
      <div className="max-w-2xl text-center">
        <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-[var(--landing-accent)]">
          {frame.eyebrow}
        </p>
        <h3 className="mt-3 font-[var(--font-heading)] text-[clamp(1.6rem,3.4vw,2.6rem)] font-medium leading-[1.04] tracking-[-0.03em] text-[var(--landing-text-strong)]">
          {frame.title}
        </h3>
        <p className="mt-3 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.28em] text-[var(--landing-muted-strong)]">
          {frame.detail}
        </p>
      </div>
    </motion.div>
  );
}

function StaticGrid() {
  return (
    <div className="landing-container px-6 py-20 sm:px-10 sm:py-24">
      <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-[var(--landing-accent)]">
        ◢ {landingCopy.showcase.eyebrow.toLowerCase()}
      </p>
      <h2 className="landing-section-title mt-4 max-w-[16ch]">
        {landingCopy.showcase.title}
      </h2>
      <p className="landing-section-copy mt-6 max-w-2xl">
        {landingCopy.showcase.description}
      </p>
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {showcaseFrames.map((frame) => (
          <article
            key={frame.id}
            className="landing-panel overflow-hidden rounded-[1.5rem]"
          >
            <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-white/8">
              <FramePlate frame={frame} priority={false} />
            </div>
            <div className="p-5">
              <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-[var(--landing-accent)]">
                {frame.eyebrow}
              </p>
              <h3 className="landing-display-value mt-3 text-2xl">{frame.title}</h3>
              <p className="mt-3 text-base leading-7 text-[var(--landing-muted-strong)]">
                {frame.detail}
              </p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function TerminalShowcase() {
  const sectionRef = useRef<HTMLElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const staticMode = Boolean(prefersReducedMotion);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  const total = showcaseFrames.length;
  const railProgress = useTransform(scrollYProgress, [0, 1], [0, 1]);

  if (staticMode) {
    return (
      <section
        id="showcase"
        ref={sectionRef}
        aria-label={landingCopy.showcase.title}
        className="relative"
      >
        <StaticGrid />
      </section>
    );
  }

  return (
    <section
      id="showcase"
      ref={sectionRef}
      aria-label={landingCopy.showcase.title}
      className="relative"
      style={{ height: `${total * 100}vh` }}
    >
      <div className="sticky top-0 h-screen w-full overflow-hidden bg-[#080b0d]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:148px_148px] opacity-25"
        />

        <div className="pointer-events-none absolute left-0 right-0 top-7 flex items-center justify-between px-6 sm:px-10">
          <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-[var(--landing-accent)]/80">
            ◢ {landingCopy.showcase.eyebrow.toLowerCase()}
          </span>
          <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
            {landingCopy.showcase.title.toLowerCase()}
          </span>
        </div>

        {showcaseFrames.map((frame, index) => (
          <Frame
            key={frame.id}
            frame={frame}
            index={index}
            total={total}
            progress={scrollYProgress}
          />
        ))}

        {showcaseFrames.map((frame, index) => (
          <FrameCaption
            key={`caption-${frame.id}`}
            frame={frame}
            index={index}
            total={total}
            progress={scrollYProgress}
          />
        ))}

        <div className="pointer-events-none absolute bottom-7 left-0 right-0 px-6 sm:px-10">
          <div className="relative h-px w-full overflow-hidden bg-white/10">
            <motion.span
              aria-hidden
              className="absolute inset-y-0 left-0 block w-full bg-[var(--landing-accent)]"
              style={{ transformOrigin: "0% 50%", scaleX: railProgress }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between font-[var(--font-mono)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
            <span>scroll → step through the terminal</span>
            <span>{total.toString().padStart(2, "0")} screens</span>
          </div>
        </div>
      </div>
    </section>
  );
}
