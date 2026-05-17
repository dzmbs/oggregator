"use client";

import { useFrame } from "@react-three/fiber";
import type { MotionValue } from "framer-motion";
import { useMemo, useRef } from "react";
import { BufferAttribute, Color, DoubleSide, type Mesh, PlaneGeometry } from "three";

const SEGMENTS_X = 32;
const SEGMENTS_Y = 22;
const PLANE_WIDTH = 11.4;
const PLANE_HEIGHT = 7.4;
const Z_MIN = 28;
const Z_MAX = 62;
const Z_SCALE = 0.085;
const PHASE_STEP_PERIOD = 0.8;

const GRADIENT_STOPS = [
  { t: 0, color: new Color("#1e40af") },
  { t: 0.35, color: new Color("#60a5fa") },
  { t: 0.5, color: new Color("#f5f5f5") },
  { t: 0.7, color: new Color("#fb923c") },
  { t: 1, color: new Color("#ea580c") },
];

function sampleGradient(t: number, target: Color) {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i += 1) {
    const a = GRADIENT_STOPS[i]!;
    const b = GRADIENT_STOPS[i + 1]!;
    if (clamped <= b.t) {
      const span = b.t - a.t;
      const local = span <= 0 ? 0 : (clamped - a.t) / span;
      target.copy(a.color).lerp(b.color, local);
      return;
    }
  }
  target.copy(GRADIENT_STOPS[GRADIENT_STOPS.length - 1]!.color);
}

function computeIv(
  deltaIndex: number,
  tenorIndex: number,
  phase: number,
  drift: number,
) {
  const delta = deltaIndex / SEGMENTS_X;
  const tenorRatio = tenorIndex / SEGMENTS_Y;

  const smile = Math.abs(delta - 0.5) * 34;
  const term = (1 - tenorRatio) * 8;
  const humpExp = (tenorRatio - 0.34) * (tenorRatio - 0.34);
  const hump = Math.exp(-humpExp / 0.02) * 10;
  const wave = Math.sin(phase + delta * 8.5 + tenorRatio * 3.2) * 1.6;
  const skew =
    Math.cos(phase * 0.55 + tenorRatio * 2.5) * (0.5 - delta) * 14;
  const pulseExp = (delta - 0.68) * (delta - 0.68);
  const pulse =
    Math.exp(-pulseExp / 0.018) *
    Math.cos(phase * 0.7 + tenorRatio * 5.8) *
    2.2;

  return 28 + smile + term + hump + wave + skew + pulse + drift;
}

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

function buildGeometry() {
  const geometry = new PlaneGeometry(
    PLANE_WIDTH,
    PLANE_HEIGHT,
    SEGMENTS_X,
    SEGMENTS_Y,
  );
  const vertexCount = geometry.attributes.position?.count ?? 0;
  const colorArray = new Float32Array(vertexCount * 3);
  geometry.setAttribute("color", new BufferAttribute(colorArray, 3));
  return { geometry, colorArray };
}

function refreshGeometry(
  geometry: PlaneGeometry,
  colorArray: Float32Array,
  phase: number,
  drift: number,
) {
  const positions = geometry.attributes.position;
  const colorAttr = geometry.attributes.color;
  if (!positions || !colorAttr) return;

  const span = Z_MAX - Z_MIN;
  const tmp = new Color();

  let vertex = 0;
  for (let yi = 0; yi <= SEGMENTS_Y; yi += 1) {
    for (let xi = 0; xi <= SEGMENTS_X; xi += 1) {
      const iv = computeIv(xi, yi, phase, drift);
      const z = (iv - Z_MIN) * Z_SCALE;
      positions.setZ(vertex, z);

      const t = (iv - Z_MIN) / span;
      sampleGradient(t, tmp);
      const offset = vertex * 3;
      colorArray[offset] = tmp.r;
      colorArray[offset + 1] = tmp.g;
      colorArray[offset + 2] = tmp.b;

      vertex += 1;
    }
  }

  positions.needsUpdate = true;
  colorAttr.needsUpdate = true;
}

export function TheaterSurfaceMesh({
  scrollProgress,
}: {
  scrollProgress: MotionValue<number>;
}) {
  const { geometry, colorArray } = useMemo(() => buildGeometry(), []);
  const surfaceRef = useRef<Mesh>(null);
  const phaseRef = useRef(0);
  const lastUpdateRef = useRef(0);

  useMemo(() => {
    refreshGeometry(geometry, colorArray, 0, 0);
  }, [geometry, colorArray]);

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime;

    if (elapsed - lastUpdateRef.current > PHASE_STEP_PERIOD) {
      phaseRef.current += PHASE_STEP_PERIOD;
      const drift = Math.sin(elapsed * 0.32) * 1.6;
      refreshGeometry(geometry, colorArray, phaseRef.current, drift);
      lastUpdateRef.current = elapsed;
    }

    const mesh = surfaceRef.current;
    if (!mesh) return;

    const target = sampleScene(scrollProgress.get());
    const breath = Math.sin(elapsed * 0.18) * 0.04;
    const drift = Math.sin(elapsed * 0.12) * 0.08;
    const bob = Math.sin(elapsed * 0.22) * 0.05;

    mesh.rotation.x = target.rotX + breath;
    mesh.rotation.y = target.rotY + drift;
    mesh.position.y = target.posY + bob;
    mesh.position.z = target.posZ;
  });

  return (
    <mesh ref={surfaceRef} geometry={geometry} frustumCulled={false}>
      <meshBasicMaterial
        vertexColors
        side={DoubleSide}
        fog={false}
        toneMapped={false}
      />
    </mesh>
  );
}
