import styles from "./StrategyIcon.module.css";

interface StrategyIconProps {
  strategy: string | null;
  size?: number;
}

// Payoff-shape SVG paths that traders recognize at a glance
const STRATEGY_PATHS: Record<string, string> = {
  CALL:                 "M2,14 L10,14 L18,2",
  PUT:                  "M2,2 L10,14 L18,14",
  STRADDLE:             "M2,2 L10,14 L18,2",
  STRANGLE:             "M2,2 L6,14 L14,14 L18,2",
  CALL_SPREAD:          "M2,14 L8,14 L12,4 L18,4",
  PUT_SPREAD:           "M2,4 L8,4 L12,14 L18,14",
  CALL_BUTTERFLY:       "M2,14 L6,14 L10,2 L14,14 L18,14",
  PUT_BUTTERFLY:        "M2,14 L6,14 L10,2 L14,14 L18,14",
  CALL_BUTTERFLY_SPREAD:"M2,14 L6,14 L10,2 L14,14 L18,14",
  PUT_BUTTERFLY_SPREAD: "M2,14 L6,14 L10,2 L14,14 L18,14",
  IRON_CONDOR:          "M2,14 L5,14 L7,4 L13,4 L15,14 L18,14",
  IRON_BUTTERFLY:       "M2,14 L5,14 L10,2 L15,14 L18,14",
  CALL_CALENDAR_SPREAD: "M4,2 L4,14 M10,2 L10,14",
  PUT_CALENDAR_SPREAD:  "M4,2 L4,14 M10,2 L10,14",
  CALL_DIAGONAL:        "M3,2 L3,14 M11,4 L11,12",
  PUT_DIAGONAL:         "M3,2 L3,14 M11,4 L11,12",
  CALL_RATIO:           "M2,14 L8,14 L11,2 L14,14 L18,14",
  PUT_RATIO:            "M2,14 L8,14 L11,2 L14,14 L18,14",
  COMBO:                "M2,10 L8,2 L12,14 L18,6",
};

const STRATEGY_LABELS: Record<string, string> = {
  CALL: "Call",
  PUT: "Put",
  STRADDLE: "Straddle",
  STRANGLE: "Strangle",
  CALL_SPREAD: "Call Spread",
  PUT_SPREAD: "Put Spread",
  CALL_BUTTERFLY: "Butterfly",
  PUT_BUTTERFLY: "Butterfly",
  CALL_BUTTERFLY_SPREAD: "Butterfly",
  PUT_BUTTERFLY_SPREAD: "Butterfly",
  IRON_CONDOR: "Iron Condor",
  IRON_BUTTERFLY: "Iron Fly",
  CALL_CALENDAR_SPREAD: "Calendar",
  PUT_CALENDAR_SPREAD: "Calendar",
  CALL_DIAGONAL: "Diagonal",
  PUT_DIAGONAL: "Diagonal",
  CALL_RATIO: "Ratio",
  PUT_RATIO: "Ratio",
  COMBO: "Combo",
  CUSTOM: "Custom",
};

export function getStrategyLabel(strategy: string | null, legType?: string): string {
  if (!strategy) return legType === "CALL" ? "Call" : legType === "PUT" ? "Put" : "Single";
  return STRATEGY_LABELS[strategy] ?? strategy;
}

export default function StrategyIcon({ strategy, size = 20 }: StrategyIconProps) {
  const path = strategy ? STRATEGY_PATHS[strategy] : null;

  if (!path) {
    return (
      <span className={styles.fallback} style={{ width: size, height: size }}>
        ●
      </span>
    );
  }

  return (
    <svg
      className={styles.icon}
      width={size}
      height={size}
      viewBox="0 0 20 16"
      fill="none"
      aria-label={getStrategyLabel(strategy)}
    >
      <path d={path} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
