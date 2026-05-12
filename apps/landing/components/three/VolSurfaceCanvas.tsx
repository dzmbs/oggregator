"use client";

import { Canvas } from "@react-three/fiber";

import { SurfaceMesh } from "./SurfaceMesh";

export default function VolSurfaceCanvas() {
  return (
    <div className="h-[28rem] overflow-hidden rounded-[1.75rem] bg-[#0d0e11]">
      <Canvas camera={{ position: [0, 2.3, 5.6], fov: 48 }}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 5, 3]} intensity={1.35} />
        <pointLight position={[-3, -1, 2]} intensity={0.45} color="#f2ede2" />
        <SurfaceMesh />
      </Canvas>
    </div>
  );
}
