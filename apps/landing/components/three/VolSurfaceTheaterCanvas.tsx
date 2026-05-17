"use client";

import { Canvas } from "@react-three/fiber";
import type { MotionValue } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { TheaterSurfaceMesh } from "./TheaterSurfaceMesh";

function canRenderInteractiveSurface() {
  return (
    typeof window !== "undefined" &&
    typeof window.WebGLRenderingContext !== "undefined"
  );
}

export default function VolSurfaceTheaterCanvas({
  scrollProgress,
}: {
  scrollProgress: MotionValue<number>;
}) {
  const [canRenderCanvas, setCanRenderCanvas] = useState(false);
  const [inView, setInView] = useState(true);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => {
      setCanRenderCanvas(!motionQuery.matches && canRenderInteractiveSurface());
    };
    syncPreference();

    if (typeof motionQuery.addEventListener === "function") {
      motionQuery.addEventListener("change", syncPreference);
      return () => motionQuery.removeEventListener("change", syncPreference);
    }
    motionQuery.addListener(syncPreference);
    return () => motionQuery.removeListener(syncPreference);
  }, []);

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setInView(entry.isIntersecting);
      },
      { rootMargin: "120px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!canRenderCanvas) {
    return (
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_30%_52%,_rgba(64,128,255,0.18),_transparent_45%),_radial-gradient(circle_at_72%_42%,_rgba(251,146,60,0.22),_transparent_45%),_#0a0a0a]"
      />
    );
  }

  return (
    <div ref={wrapperRef} className="absolute inset-0">
      <Canvas
        camera={{ fov: 30, position: [4.6, -1.4, 6.8] }}
        className="h-full w-full"
        dpr={[1, 1.25]}
        frameloop={inView ? "always" : "never"}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#0a0a0a"]} />
        <fog attach="fog" args={["#0a0a0a", 12, 22]} />
        <TheaterSurfaceMesh scrollProgress={scrollProgress} />
      </Canvas>
    </div>
  );
}
