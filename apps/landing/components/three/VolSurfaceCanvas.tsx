"use client";

import { Canvas } from "@react-three/fiber";
import { useEffect, useState } from "react";

import { SurfaceFallback } from "./SurfaceFallback";
import { SurfaceMesh } from "./SurfaceMesh";

function canRenderInteractiveSurface() {
  return (
    typeof window !== "undefined" &&
    typeof window.WebGLRenderingContext !== "undefined"
  );
}

export default function VolSurfaceCanvas() {
  const [canRenderCanvas, setCanRenderCanvas] = useState(false);

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

  if (!canRenderCanvas) {
    return <SurfaceFallback />;
  }

  return (
    <div className="relative h-[30rem] overflow-hidden rounded-[2rem] border border-white/6 bg-[#0f1013]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,_rgba(215,122,82,0.2),_transparent_24%),_linear-gradient(180deg,_rgba(255,255,255,0.03),_rgba(255,255,255,0))]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-[5%] rounded-[1.5rem] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:100%_18%,10%_100%] opacity-35"
      />

      <div className="absolute left-5 top-5 z-10">
        <p className="font-[var(--font-mono)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
          Live view
        </p>
        <p className="mt-2 text-sm text-zinc-300">
          Surface tilt follows front-end pressure and wing steepness.
        </p>
      </div>

      <Canvas
        camera={{ fov: 34, position: [0, 3.8, 8.1] }}
        className="h-full w-full"
        dpr={[1, 1.5]}
      >
        <color attach="background" args={["#0f1013"]} />
        <fog attach="fog" args={["#0f1013", 9, 16]} />
        <ambientLight intensity={0.65} />
        <directionalLight color="#f3f0e8" intensity={1.3} position={[4, 5, 5]} />
        <directionalLight color="#d77a52" intensity={1.8} position={[-4, 3, 2]} />
        <SurfaceMesh />
      </Canvas>

      <div className="pointer-events-none absolute bottom-5 left-5 z-10 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
        Tenor progression
      </div>
      <div className="pointer-events-none absolute bottom-5 right-5 z-10 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
        Delta buckets
      </div>
    </div>
  );
}
