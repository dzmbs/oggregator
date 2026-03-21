import { useAppStore } from "@stores/app-store";
import { useOpenPalette } from "@components/layout";
import { getTokenLogo } from "@lib/token-meta";

import styles from "./AssetPickerButton.module.css";

export default function AssetPickerButton() {
  const underlying  = useAppStore((s) => s.underlying);
  const openPalette = useOpenPalette();
  const logo        = getTokenLogo(underlying);

  return (
    <button className={styles.btn} onClick={openPalette}>
      {logo && <img src={logo} className={styles.logo} alt={underlying} />}
      <span className={styles.label}>{underlying}</span>
      <span className={styles.chevron}>▾</span>
    </button>
  );
}
