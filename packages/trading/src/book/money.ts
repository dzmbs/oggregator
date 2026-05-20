export type UsdAmount = number;

export function addUsd(a: UsdAmount, b: UsdAmount): UsdAmount {
  return round(a + b);
}

export function subUsd(a: UsdAmount, b: UsdAmount): UsdAmount {
  return round(a - b);
}

export function mulUsd(a: UsdAmount, factor: number): UsdAmount {
  return round(a * factor);
}

function round(value: number): UsdAmount {
  return Math.round(value * 1e8) / 1e8;
}
