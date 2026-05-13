"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useState, useEffect, type ReactNode } from "react";

export function SectionReveal({
  children,
}: Readonly<{ children: ReactNode }>) {
  const prefersReducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (
    prefersReducedMotion ||
    !mounted ||
    typeof window === "undefined" ||
    typeof window.IntersectionObserver === "undefined"
  ) {
    return <>{children}</>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
