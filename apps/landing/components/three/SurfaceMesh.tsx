"use client";

import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import type { Mesh } from "three";
import { DoubleSide, PlaneGeometry } from "three";

function createSurfaceGeometry() {
  const geometry = new PlaneGeometry(9.4, 5.8, 52, 34);
  const positions = geometry.attributes.position;

  if (!positions) {
    return geometry;
  }

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const strike = x / 4.7;
    const tenor = (y + 2.9) / 5.8;
    const smile = 0.88 * strike * strike;
    const termSlope = 0.72 * tenor;
    const wingPressure = Math.exp(-((strike - 0.36) * (strike - 0.36)) * 7) * 0.24;
    const localDip = Math.exp(-((strike + 0.42) * (strike + 0.42)) * 9) * 0.18;
    const ripple = Math.sin((tenor + 0.08) * Math.PI * 2.1) * 0.08;

    positions.setZ(
      index,
      0.3 + smile + termSlope + wingPressure - localDip + ripple,
    );
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  return geometry;
}

export function SurfaceMesh() {
  const [geometry] = useState(createSurfaceGeometry);
  const surfaceRef = useRef<Mesh>(null);
  const wireRef = useRef<Mesh>(null);

  useFrame((state) => {
    const rotationY = Math.sin(state.clock.elapsedTime * 0.18) * 0.2;
    const rotationX = -1.07 + Math.cos(state.clock.elapsedTime * 0.12) * 0.03;
    const positionY = -0.55 + Math.sin(state.clock.elapsedTime * 0.24) * 0.08;

    if (surfaceRef.current) {
      surfaceRef.current.rotation.x = rotationX;
      surfaceRef.current.rotation.y = rotationY;
      surfaceRef.current.position.y = positionY;
    }

    if (wireRef.current) {
      wireRef.current.rotation.x = rotationX;
      wireRef.current.rotation.y = rotationY;
      wireRef.current.position.y = positionY;
    }
  });

  return (
    <group>
      <mesh
        ref={surfaceRef}
        geometry={geometry}
        position={[0, -0.55, 0]}
        rotation={[-1.07, 0, 0]}
      >
        <meshStandardMaterial
          color="#2a1b16"
          emissive="#1d120f"
          emissiveIntensity={0.55}
          metalness={0.12}
          roughness={0.24}
          side={DoubleSide}
          transparent
          opacity={0.88}
        />
      </mesh>
      <mesh
        ref={wireRef}
        geometry={geometry}
        position={[0, -0.55, 0.02]}
        rotation={[-1.07, 0, 0]}
      >
        <meshStandardMaterial
          color="#d77a52"
          emissive="#d77a52"
          emissiveIntensity={0.38}
          transparent
          opacity={0.68}
          wireframe
        />
      </mesh>
    </group>
  );
}
