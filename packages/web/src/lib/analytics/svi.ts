// Raw SVI implied total-variance fit (Gatheral 2004).
// Mirror of packages/core/src/services/svi-fit.ts — the web package does not
// depend on @oggregator/core (per project CLAUDE.md), so the calibration
// math is duplicated. Both copies must stay in sync.

export interface SviParams {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

export interface SviFitPoint {
  k: number;
  iv: number;
}

export function sviTotalVariance(params: SviParams, k: number): number {
  const z = k - params.m;
  return params.a + params.b * (params.rho * z + Math.sqrt(z * z + params.sigma * params.sigma));
}

export function sviIv(params: SviParams, k: number, T: number): number {
  if (T <= 0) return NaN;
  const w = sviTotalVariance(params, k);
  return Math.sqrt(Math.max(0, w) / T);
}

const RHO_CLAMP = 0.999;
const PENALTY_WEIGHT = 1e6;
const NM_MAX_ITER = 250;
const NM_TOL = 1e-12;
const BUTTERFLY_SAMPLES = 64;
const BUTTERFLY_TOL = 1e-9;

// Roger Lee density-positivity check: g(k) ≥ 0 across the calibrated range.
// Necessary parameter constraints (b≥0, |ρ|<1, σ>0, a + b·σ·√(1−ρ²) ≥ 0) are
// not sufficient — this evaluates the actual implied density and rejects
// any sample where it goes negative.
export function isButterflyArbFree(params: SviParams, kMin: number, kMax: number): boolean {
  if (!Number.isFinite(kMin) || !Number.isFinite(kMax) || kMax < kMin) return false;
  for (let i = 0; i <= BUTTERFLY_SAMPLES; i++) {
    const k = kMin + ((kMax - kMin) * i) / BUTTERFLY_SAMPLES;
    const z = k - params.m;
    const y = Math.sqrt(z * z + params.sigma * params.sigma);
    const w = params.a + params.b * (params.rho * z + y);
    if (w <= 0) return false;
    const wp = params.b * (params.rho + z / y);
    const wpp = (params.b * params.sigma * params.sigma) / (y * y * y);
    const term1 = (1 - (k * wp) / (2 * w)) ** 2;
    const term2 = ((wp * wp) / 4) * (1 / w + 1 / 4);
    const term3 = wpp / 2;
    if (term1 - term2 + term3 < -BUTTERFLY_TOL) return false;
  }
  return true;
}

export function fitSvi(points: readonly SviFitPoint[], T: number): SviParams | null {
  if (T <= 0 || points.length < 5) return null;
  for (const p of points) {
    if (!Number.isFinite(p.k) || !Number.isFinite(p.iv) || p.iv <= 0) return null;
  }

  const data = points.map((p) => ({ k: p.k, w: p.iv * p.iv * T }));
  const sortedKs = data.map((d) => d.k).slice().sort((a, b) => a - b);
  const m0 = sortedKs[Math.floor(sortedKs.length / 2)] ?? 0;
  const lo = sortedKs[0] ?? -0.5;
  const hi = sortedKs[sortedKs.length - 1] ?? 0.5;
  const sigma0 = Math.max(0.05, (hi - lo) / 4);

  const objective = ([m, sigma]: readonly [number, number]): number => {
    if (sigma <= 1e-6) return Number.POSITIVE_INFINITY;
    return solveInner(data, m, sigma).sse;
  };

  const [m, sigma] = nelderMead2D([m0, sigma0], objective);
  const inner = solveInner(data, m, sigma);
  if (!inner.params) return null;

  const { a, p, q } = inner.params;
  if (q < 0) return null;
  let rho = q > 1e-12 ? p / q : 0;
  if (rho > RHO_CLAMP) rho = RHO_CLAMP;
  if (rho < -RHO_CLAMP) rho = -RHO_CLAMP;
  const b = q;

  if (a + b * sigma * Math.sqrt(1 - rho * rho) < -1e-6) return null;
  const fit: SviParams = { a, b, rho, m, sigma };
  if (!isButterflyArbFree(fit, lo, hi)) return null;
  return fit;
}

interface InnerResult {
  params: { a: number; p: number; q: number } | null;
  sse: number;
}

function solveInner(
  data: readonly { k: number; w: number }[],
  m: number,
  sigma: number,
): InnerResult {
  let s11 = data.length;
  let s1z = 0;
  let s1y = 0;
  let szz = 0;
  let szy = 0;
  let syy = 0;
  let s1w = 0;
  let szw = 0;
  let syw = 0;

  for (const { k, w } of data) {
    const z = k - m;
    const y = Math.sqrt(z * z + sigma * sigma);
    s1z += z;
    s1y += y;
    szz += z * z;
    szy += z * y;
    syy += y * y;
    s1w += w;
    szw += z * w;
    syw += y * w;
  }

  const sol = solve3x3(
    [
      [s11, s1z, s1y],
      [s1z, szz, szy],
      [s1y, szy, syy],
    ],
    [s1w, szw, syw],
  );
  if (!sol) return { params: null, sse: Number.POSITIVE_INFINITY };
  const [a, p, q] = sol;

  let sse = 0;
  for (const { k, w } of data) {
    const z = k - m;
    const y = Math.sqrt(z * z + sigma * sigma);
    const wPred = a + p * z + q * y;
    sse += (w - wPred) * (w - wPred);
  }

  if (q < 0) sse += PENALTY_WEIGHT * q * q;
  const overflow = Math.abs(p) - q;
  if (overflow > 0) sse += PENALTY_WEIGHT * overflow * overflow;

  return { params: { a, p, q }, sse };
}

function solve3x3(
  A: readonly (readonly number[])[],
  b: readonly number[],
): [number, number, number] | null {
  const a00 = A[0]![0]!, a01 = A[0]![1]!, a02 = A[0]![2]!;
  const a10 = A[1]![0]!, a11 = A[1]![1]!, a12 = A[1]![2]!;
  const a20 = A[2]![0]!, a21 = A[2]![1]!, a22 = A[2]![2]!;
  const b0 = b[0]!, b1 = b[1]!, b2 = b[2]!;

  const det =
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20);
  if (Math.abs(det) < 1e-14) return null;

  const x0 =
    (b0 * (a11 * a22 - a12 * a21) -
      a01 * (b1 * a22 - a12 * b2) +
      a02 * (b1 * a21 - a11 * b2)) /
    det;
  const x1 =
    (a00 * (b1 * a22 - a12 * b2) -
      b0 * (a10 * a22 - a12 * a20) +
      a02 * (a10 * b2 - b1 * a20)) /
    det;
  const x2 =
    (a00 * (a11 * b2 - b1 * a21) -
      a01 * (a10 * b2 - b1 * a20) +
      b0 * (a10 * a21 - a11 * a20)) /
    det;

  if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(x2)) return null;
  return [x0, x1, x2];
}

type Vertex2D = { x: readonly [number, number]; f: number };

function nelderMead2D(
  start: readonly [number, number],
  fn: (x: readonly [number, number]) => number,
): [number, number] {
  let simplex: Vertex2D[] = [
    { x: [start[0], start[1]], f: fn(start) },
    { x: [start[0] + 0.1, start[1]], f: fn([start[0] + 0.1, start[1]]) },
    { x: [start[0], start[1] + 0.05], f: fn([start[0], start[1] + 0.05]) },
  ];

  for (let iter = 0; iter < NM_MAX_ITER; iter++) {
    simplex.sort((va, vb) => va.f - vb.f);
    const best = simplex[0]!;
    const mid = simplex[1]!;
    const worst = simplex[2]!;
    if (worst.f - best.f < NM_TOL) break;

    const centroid: [number, number] = [
      (best.x[0] + mid.x[0]) / 2,
      (best.x[1] + mid.x[1]) / 2,
    ];
    const reflected: [number, number] = [
      centroid[0] + (centroid[0] - worst.x[0]),
      centroid[1] + (centroid[1] - worst.x[1]),
    ];
    const fReflected = fn(reflected);

    if (fReflected < mid.f && fReflected >= best.f) {
      simplex[2] = { x: reflected, f: fReflected };
      continue;
    }
    if (fReflected < best.f) {
      const expanded: [number, number] = [
        centroid[0] + 2 * (centroid[0] - worst.x[0]),
        centroid[1] + 2 * (centroid[1] - worst.x[1]),
      ];
      const fExpanded = fn(expanded);
      simplex[2] = fExpanded < fReflected
        ? { x: expanded, f: fExpanded }
        : { x: reflected, f: fReflected };
      continue;
    }

    const contracted: [number, number] = [
      centroid[0] + 0.5 * (worst.x[0] - centroid[0]),
      centroid[1] + 0.5 * (worst.x[1] - centroid[1]),
    ];
    const fContracted = fn(contracted);
    if (fContracted < worst.f) {
      simplex[2] = { x: contracted, f: fContracted };
      continue;
    }

    simplex = simplex.map((vertex, i) => {
      if (i === 0) return vertex;
      const x: [number, number] = [
        best.x[0] + 0.5 * (vertex.x[0] - best.x[0]),
        best.x[1] + 0.5 * (vertex.x[1] - best.x[1]),
      ];
      return { x, f: fn(x) };
    });
  }

  simplex.sort((va, vb) => va.f - vb.f);
  const winner = simplex[0]!;
  return [winner.x[0], winner.x[1]];
}
