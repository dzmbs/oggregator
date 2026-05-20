"use client";

import {
  motion,
  useMotionValue,
  useScroll,
  useTransform,
  useReducedMotion,
  type MotionValue,
} from "framer-motion";
import dynamic from "next/dynamic";
import { useEffect, useRef, type ReactNode } from "react";

import { landingCopy } from "@/lib/copy";

const VolSurfaceTheaterCanvas = dynamic(
  () => import("./three/VolSurfaceTheaterCanvas"),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_30%_52%,_rgba(64,128,255,0.18),_transparent_45%),_radial-gradient(circle_at_72%_42%,_rgba(251,146,60,0.22),_transparent_45%),_#0a0a0a]"
      />
    ),
  },
);

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function HeroScene({
  scrollYProgress,
  start,
  end,
  staticVisible,
  children,
  pointerEvents,
}: {
  scrollYProgress: MotionValue<number>;
  start: number;
  end: number;
  staticVisible: boolean;
  children: ReactNode;
  pointerEvents?: boolean;
}) {
  const span = Math.max(end - start, 0.001);
  const center = (start + end) / 2;
  const fadeIn = span * 0.35;
  const fadeOut = span * 0.35;

  const opacity = useTransform(scrollYProgress, (value) => {
    if (value < start - fadeIn) return 0;
    if (value > end + fadeOut) return 0;
    if (value < start) return clamp01((value - (start - fadeIn)) / fadeIn);
    if (value > end) return clamp01(1 - (value - end) / fadeOut);
    return 1;
  });

  const y = useTransform(scrollYProgress, (value) => {
    const local = (value - center) / span;
    return local * -28;
  });

  return (
    <motion.div
      className={
        (pointerEvents ? "" : "pointer-events-none ") +
        "absolute inset-0 flex items-center px-6 sm:px-10"
      }
      style={staticVisible ? { opacity: 1 } : { opacity, y }}
    >
      <div className="landing-container w-full">{children}</div>
    </motion.div>
  );
}

export function HeroTerminalSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const staticMode = Boolean(prefersReducedMotion);

  const scrollProgress = useMotionValue(0);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  useEffect(() => {
    return scrollYProgress.on("change", (value) => {
      scrollProgress.set(clamp01(value));
    });
  }, [scrollYProgress, scrollProgress]);

  const surfaceScale = useTransform(scrollYProgress, [0, 0.5, 1], [1, 0.92, 0.84]);
  const surfaceX = useTransform(scrollYProgress, [0, 0.5, 1], ["0%", "16%", "26%"]);
  const surfaceOpacity = useTransform(scrollYProgress, [0, 0.55, 1], [1, 0.7, 0.55]);

  const scrollHintOpacity = useTransform(scrollYProgress, [0, 0.12], [1, 0]);
  const ruleProgress = useTransform(scrollYProgress, [0.04, 0.98], [0, 1]);

  return (
    <section
      id="hero"
      ref={sectionRef}
      aria-label="Hero · terminal-first options intelligence"
      className="relative"
      style={{ height: staticMode ? "auto" : "240vh" }}
    >
      <div
        className={
          staticMode
            ? "relative w-full overflow-hidden bg-[#080b0d]"
            : "sticky top-0 h-screen w-full overflow-hidden bg-[#080b0d]"
        }
      >
        <motion.div
          aria-label="Interactive 3D volatility surface"
          role="img"
          className="absolute inset-0"
          {...(staticMode
            ? {}
            : {
                style: {
                  scale: surfaceScale,
                  x: surfaceX,
                  opacity: surfaceOpacity,
                  transformOrigin: "50% 50%",
                },
              })}
        >
          <VolSurfaceTheaterCanvas scrollProgress={scrollProgress} />

          <div
            aria-hidden
            className="pointer-events-none absolute right-6 top-1/2 hidden -translate-y-1/2 flex-col items-center gap-2 md:flex md:right-10"
          >
            <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.3em] text-zinc-400">
              IV %
            </span>
            <div className="flex h-56 items-stretch gap-2">
              <div
                className="w-2 rounded-full"
                style={{
                  backgroundImage:
                    "linear-gradient(180deg, #ea580c 0%, #fb923c 30%, #f5f5f5 50%, #60a5fa 75%, #1e40af 100%)",
                }}
              />
              <div className="flex flex-col justify-between font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                <span>55</span>
                <span>50</span>
                <span>45</span>
                <span>40</span>
                <span>35</span>
                <span>30</span>
              </div>
            </div>
          </div>

          <div
            aria-hidden
            className="pointer-events-none absolute bottom-24 left-6 hidden flex-col gap-1 font-[var(--font-mono)] text-[9px] uppercase tracking-[0.28em] text-zinc-600 md:flex md:left-10"
          >
            <span>x · delta</span>
            <span>y · tenor</span>
            <span>z · iv %</span>
          </div>
        </motion.div>

        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(8,11,13,0.5)_0%,rgba(8,11,13,0)_22%,rgba(8,11,13,0)_70%,rgba(8,11,13,0.92)_100%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:148px_148px] opacity-30 mix-blend-screen"
        />

        <div className="pointer-events-none absolute left-0 right-0 top-7 flex items-center justify-between px-6 sm:px-10">
          <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-[var(--landing-accent)]/80">
            ◢ surface.live
          </span>
          <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
            tenor · delta · venue
          </span>
        </div>

        <div className="pointer-events-none absolute bottom-7 left-0 right-0 px-6 sm:px-10">
          <div className="relative h-px w-full overflow-hidden bg-white/10">
            <motion.span
              aria-hidden
              className="absolute inset-y-0 left-0 block w-full bg-[var(--landing-accent)]"
              style={
                staticMode
                  ? { transform: "scaleX(0.4)", transformOrigin: "0% 50%" }
                  : { transformOrigin: "0% 50%", scaleX: ruleProgress }
              }
            />
          </div>
          <div className="mt-3 flex items-center justify-between font-[var(--font-mono)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
            <motion.span
              {...(staticMode ? {} : { style: { opacity: scrollHintOpacity } })}
            >
              scroll → dive into the surface
            </motion.span>
            <span>three depths · one object</span>
          </div>
        </div>

        <HeroScene
          scrollYProgress={scrollYProgress}
          start={0}
          end={0.42}
          staticVisible={false}
        >
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-3 border border-white/15 bg-white/[0.03] px-4 py-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-zinc-300">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--landing-accent)] shadow-[0_0_12px_rgba(237,244,246,0.55)]" />
              surface.live · tick-by-tick
            </span>
            <p className="mt-12 max-w-xl font-[var(--font-mono)] text-[11px] uppercase leading-6 tracking-[0.32em] text-zinc-400">
              a real volatility surface — not a screenshot. tilt, skew, term and venue context, recalculated tick-by-tick.
            </p>
          </div>
        </HeroScene>

        <HeroScene
          scrollYProgress={scrollYProgress}
          start={0.4}
          end={1}
          staticVisible={staticMode}
          pointerEvents
        >
          <div className="max-w-3xl">
            <span className="landing-chip">
              <span className="h-2 w-2 rounded-full bg-[var(--landing-accent)] shadow-[0_0_18px_rgba(237,244,246,0.55)]" />
              {landingCopy.hero.eyebrow}
            </span>
            <h1 className="landing-display-title mt-7 max-w-[14ch] text-[clamp(3.4rem,8.4vw,7.6rem)] [text-wrap:balance]">
              {landingCopy.hero.headline}
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-[var(--landing-muted-strong)] sm:text-xl">
              {landingCopy.hero.subheadline}
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <a href="#access" className="landing-button-primary">
                {landingCopy.hero.primaryCta}
              </a>
              <a href="#features" className="landing-button-secondary">
                {landingCopy.hero.secondaryCta}
              </a>
            </div>
          </div>
        </HeroScene>
      </div>
    </section>
  );
}
