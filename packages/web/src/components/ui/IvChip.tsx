import { ivLevel, ivColor } from "@lib/colors";
import { fmtIv } from "@lib/format";

import styles from "./IvChip.module.css";

interface IvChipProps {
  iv:   number | null;
  size?: "sm" | "md";
}

export default function IvChip({ iv, size = "md" }: IvChipProps) {
  const level = ivLevel(iv);
  const color = ivColor(level);

  return (
    <span
      className={styles.chip}
      data-size={size}
      style={{ color, borderColor: `${color}33`, background: `${color}14` }}
      title={iv != null ? `IV: ${(iv * 100).toFixed(2)}%` : "No IV data"}
    >
      {fmtIv(iv)}
    </span>
  );
}
