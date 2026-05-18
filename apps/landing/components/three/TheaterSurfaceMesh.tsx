"use client";

import { useFrame } from "@react-three/fiber";
import type { MotionValue } from "framer-motion";
import { useMemo, useRef } from "react";
import { DoubleSide, type Mesh, type ShaderMaterial } from "three";

const SEGMENTS_X = 64;
const SEGMENTS_Y = 44;
const PLANE_WIDTH = 11.4;
const PLANE_HEIGHT = 7.4;

const sceneCameras = [
  { rotX: -1.16, rotY: -0.28, posY: -0.62, posZ: 0 },
  { rotX: -1.0, rotY: 0.12, posY: -0.4, posZ: 0.1 },
  { rotX: -0.86, rotY: 0.36, posY: -0.18, posZ: 0.18 },
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function sampleScene(progress: number) {
  const clamped = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  const last = sceneCameras.length - 1;
  const scaled = clamped * last;
  const lower = Math.floor(scaled);
  const upper = Math.min(lower + 1, last);
  const t = scaled - lower;
  const a = sceneCameras[lower]!;
  const b = sceneCameras[upper]!;
  return {
    rotX: lerp(a.rotX, b.rotX, t),
    rotY: lerp(a.rotY, b.rotY, t),
    posY: lerp(a.posY, b.posY, t),
    posZ: lerp(a.posZ, b.posZ, t),
  };
}

const vertexShader = /* glsl */ `
  uniform float uTime;

  varying vec3 vColor;

  const float Z_MIN = 28.0;
  const float Z_MAX = 62.0;
  const float Z_SCALE = 0.085;

  const vec3 STOP0 = vec3(0.118, 0.251, 0.686);
  const vec3 STOP1 = vec3(0.376, 0.647, 0.980);
  const vec3 STOP2 = vec3(0.961, 0.961, 0.961);
  const vec3 STOP3 = vec3(0.984, 0.573, 0.235);
  const vec3 STOP4 = vec3(0.918, 0.345, 0.047);

  vec3 sampleGradient(float t) {
    t = clamp(t, 0.0, 1.0);
    if (t < 0.35) return mix(STOP0, STOP1, t / 0.35);
    if (t < 0.5)  return mix(STOP1, STOP2, (t - 0.35) / 0.15);
    if (t < 0.7)  return mix(STOP2, STOP3, (t - 0.5) / 0.2);
    return mix(STOP3, STOP4, (t - 0.7) / 0.3);
  }

  float computeIv(float delta, float tenor, float phase, float drift) {
    float smile = abs(delta - 0.5) * 34.0;
    float term = (1.0 - tenor) * 8.0;
    float humpDist = tenor - 0.34;
    float hump = exp(-(humpDist * humpDist) / 0.02) * 10.0;
    float wave = sin(phase + delta * 8.5 + tenor * 3.2) * 1.6;
    float skew = cos(phase * 0.55 + tenor * 2.5) * (0.5 - delta) * 14.0;
    float pulseDist = delta - 0.68;
    float pulse = exp(-(pulseDist * pulseDist) / 0.018)
      * cos(phase * 0.7 + tenor * 5.8) * 2.2;
    return 28.0 + smile + term + hump + wave + skew + pulse + drift;
  }

  void main() {
    float delta = uv.x;
    float tenor = uv.y;

    float phase = uTime;
    float drift = sin(uTime * 0.32) * 1.6;

    float iv = computeIv(delta, tenor, phase, drift);
    float z = (iv - Z_MIN) * Z_SCALE;

    float colorT = (iv - Z_MIN) / (Z_MAX - Z_MIN);
    vColor = sampleGradient(colorT);

    vec3 displaced = vec3(position.x, position.y, z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;

  void main() {
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

export function TheaterSurfaceMesh({
  scrollProgress,
}: {
  scrollProgress: MotionValue<number>;
}) {
  const surfaceRef = useRef<Mesh>(null);
  const materialRef = useRef<ShaderMaterial>(null);

  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime;

    if (materialRef.current) {
      materialRef.current.uniforms.uTime!.value = elapsed;
    }

    const mesh = surfaceRef.current;
    if (!mesh) return;

    const target = sampleScene(scrollProgress.get());
    const breath = Math.sin(elapsed * 0.18) * 0.04;
    const driftR = Math.sin(elapsed * 0.12) * 0.08;
    const bob = Math.sin(elapsed * 0.22) * 0.05;

    mesh.rotation.x = target.rotX + breath;
    mesh.rotation.y = target.rotY + driftR;
    mesh.position.y = target.posY + bob;
    mesh.position.z = target.posZ;
  });

  return (
    <mesh ref={surfaceRef} frustumCulled={false}>
      <planeGeometry args={[PLANE_WIDTH, PLANE_HEIGHT, SEGMENTS_X, SEGMENTS_Y]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
}
