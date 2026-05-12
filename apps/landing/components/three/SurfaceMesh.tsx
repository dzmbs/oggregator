"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Mesh } from "three";

export function SurfaceMesh() {
  const meshRef = useRef<Mesh>(null);
  const positions = useMemo(() => {
    const widthSegments = 48;
    const heightSegments = 32;
    const data: number[] = [];

    for (let y = 0; y <= heightSegments; y += 1) {
      for (let x = 0; x <= widthSegments; x += 1) {
        const u = x / widthSegments - 0.5;
        const v = y / heightSegments - 0.5;
        const z =
          Math.sin(u * Math.PI * 2.2) * 0.3 +
          Math.cos(v * Math.PI * 1.8) * 0.22 +
          (u + 0.5) * 0.35;

        data.push(u * 10, v * 6, z);
      }
    }

    return new Float32Array(data);
  }, []);

  useFrame((state) => {
    if (!meshRef.current) {
      return;
    }

    meshRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.18) * 0.08;
    meshRef.current.rotation.x = -1 + Math.cos(state.clock.elapsedTime * 0.22) * 0.05;
  });

  return (
    <mesh ref={meshRef} rotation={[-1, 0, 0]}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={positions}
          count={positions.length / 3}
          itemSize={3}
        />
      </bufferGeometry>
      <meshStandardMaterial
        color="#d77a52"
        emissive="#5a2c19"
        wireframe
        opacity={0.72}
        transparent
      />
    </mesh>
  );
}
