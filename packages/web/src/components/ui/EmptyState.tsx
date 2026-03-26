import type { ReactNode } from "react";

import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  detail?: string;
}

export default function EmptyState({ icon, title, detail }: EmptyStateProps) {
  return (
    <div className={styles.wrap}>
      {icon ? <span className={styles.icon}>{icon}</span> : <span className={styles.ornament} aria-hidden="true" />}
      <span className={styles.title}>{title}</span>
      {detail ? <span className={styles.detail}>{detail}</span> : null}
    </div>
  );
}
