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
import { useEffect, useRef } from "react";

const VolSurfaceTheaterCanvas = dynamic(
  () => import("./three/VolSurfaceTheaterCanvas"),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_22%_38%,_rgba(215,122,82,0.28),_transparent_38%),_linear-gradient(180deg,_#0a0d10,_#0f1115)]"
      />
    ),
  },
);

interface Scene {
  id: string;
  kicker: string;
  headline: string;
  body: string;
  marks: readonly string[];
}

const scenes: readonly Scene[] = [
  {
    id: "watch",
    kicker: "01 / surface",
    headline: "Watch a real surface tilt.",
    body: "Not a screenshot. The same mesh the desk reads, recalculated tick-by-tick across tenor, delta, and venue context.",
    marks: ["live tilt", "wing pressure", "term slope"],
  },
  {
    id: "pressure",
    kicker: "02 / pressure",
    headline: "Where the stress sits.",
    body: "Front-week skew, event humps, and wing steepness surface as shape before any label fights for attention.",
    marks: ["front-week", "event hump", "wing"],
  },
  {
    id: "lock",
    kicker: "03 / lock",
    headline: "Lock a node, leave the surface alone.",
    body: "Exact IV, spread, venue confidence and edge attach to the strike — no card opens, no page change, no context lost.",
    marks: ["mid iv", "spread", "venue edge"],
  },
] as const;

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function SceneFrame({
  scene,
  index,
  total,
  scrollYProgress,
  staticMode,
}: {
  scene: Scene;
  index: number;
  total: number;
  scrollYProgress: MotionValue<number>;
  staticMode: boolean;
}) {
  const slot = 1 / total;
  const start = index * slot;
  const center = start + slot / 2;
  const end = start + slot;
  const fade = slot * 0.55;

  const opacity = useTransform(scrollYProgress, (value) => {
    if (value < start - fade || value > end + fade) {
      return 0;
    }
    const distance = Math.abs(value - center);
    if (distance >= fade) {
      return 0;
    }
    return clamp01(1 - distance / fade);
  });

  const y = useTransform(scrollYProgress, (value) => {
    const local = (value - center) / slot;
    return local * -36;
  });

  const blur = useTransform(scrollYProgress, (value) => {
    const distance = Math.abs(value - center);
    if (distance >= fade) return 6;
    return distance / fade * 6;
  });

  const filter = useTransform(blur, (v) => `blur(${v}px)`);

  return (
    <motion.div
      className="absolute inset-0 flex items-center px-6 sm:px-10"
      {...(staticMode ? {} : { style: { opacity, y, filter } })}
    >
      <div className="landing-container w-full">
        <div className="max-w-3xl">
          <p className="font-[var(--font-mono)] text-[11px] uppercase tracking-[0.4em] text-[var(--landing-accent)]">
            {scene.kicker}
          </p>
          <h2 className="mt-7 font-[var(--font-heading)] text-[clamp(3rem,8.4vw,7.4rem)] font-medium leading-[0.9] tracking-[-0.055em] text-[var(--landing-text-strong)] [text-wrap:balance]">
            {scene.headline}
          </h2>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-[var(--landing-muted-strong)] sm:text-xl">
            {scene.body}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-3 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.32em] text-zinc-400">
            {scene.marks.map((mark, markIndex) => (
              <span key={mark} className="flex items-center gap-2">
                <span className="h-[6px] w-[6px] rotate-45 bg-[var(--landing-accent)]" />
                {markIndex < 9 ? `0${markIndex + 1}` : markIndex + 1}
                <span className="text-zinc-300">{mark}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function SurfaceScrollTheater() {
  const sectionRef = useRef<HTMLElement>(null);
  const prefersReducedMotion = useReducedMotion();
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

  const ruleProgress = useTransform(scrollYProgress, [0.02, 0.98], [0, 1]);
  const staticMode = Boolean(prefersReducedMotion);

  return (
    <section
      ref={sectionRef}
      aria-label="Surface scroll narrative"
      className="relative"
      style={{ height: staticMode ? "auto" : "420vh" }}
    >
      <div
        className={
          staticMode
            ? "relative flex min-h-[80vh] w-full items-stretch overflow-hidden bg-[#0a0c0f]"
            : "sticky top-0 flex h-screen w-full items-stretch overflow-hidden bg-[#0a0c0f]"
        }
      >
        <div className="absolute inset-0">
          <VolSurfaceTheaterCanvas scrollProgress={scrollProgress} />
        </div>

        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(10,12,15,0.55)_0%,rgba(10,12,15,0)_18%,rgba(10,12,15,0)_72%,rgba(10,12,15,0.9)_100%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:148px_148px] opacity-[0.35] mix-blend-screen"
        />

        <div className="pointer-events-none absolute left-0 right-0 top-7 flex items-center justify-between px-6 sm:px-10">
          <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-[var(--landing-accent)]/80">
            ◢ surface.theater
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
            <span>scroll → camera dive</span>
            <span>three depths · one object</span>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0">
          {(staticMode ? scenes.slice(0, 1) : scenes).map((scene, index) => (
            <SceneFrame
              key={scene.id}
              scene={scene}
              index={index}
              total={scenes.length}
              scrollYProgress={scrollYProgress}
              staticMode={staticMode}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
