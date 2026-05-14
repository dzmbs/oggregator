"use client";

import { useState, type FormEvent } from "react";

import { landingCopy } from "@/lib/copy";
import { leadSchema } from "@/lib/lead-schema";

const leadSource = "landing-hero";

export function LeadCaptureSection() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = leadSchema.safeParse({
      email,
      source: leadSource,
    });

    if (!parsed.success) {
      setStatus("error");
      setErrorMessage("Enter a valid work email address.");
      return;
    }

    setStatus("loading");
    setErrorMessage("");

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        setStatus("error");
        setErrorMessage("Submission failed. Try again shortly.");
        return;
      }

      setStatus("success");
      setErrorMessage("");
      setEmail("");
    } catch {
      setStatus("error");
      setErrorMessage("Submission failed. Try again shortly.");
    }
  }

  const isSubmitting = status === "loading";

  return (
    <section id="access" className="landing-container px-6 py-20 sm:px-10 sm:py-24">
      <div className="landing-panel grid gap-10 rounded-[2rem] px-8 py-10 shadow-[0_28px_100px_rgba(0,0,0,0.3)] lg:grid-cols-[1.02fr_0.98fr] lg:px-10 lg:py-12">
        <div className="max-w-2xl">
          <p className="landing-kicker">{landingCopy.cta.eyebrow}</p>
          <h2 className="landing-section-title mt-5 max-w-[10ch]">{landingCopy.cta.title}</h2>
          <p className="landing-section-copy mt-7">{landingCopy.cta.description}</p>

          <div className="mt-8 flex flex-wrap gap-3">
            {landingCopy.cta.trust.map((item) => (
              <span
                key={item}
                className="rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-zinc-300"
              >
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="landing-panel-strong rounded-[1.6rem] p-6">
          <form className="flex h-full flex-col gap-5" noValidate onSubmit={onSubmit}>
            <div>
              <label
                className="font-[var(--font-mono)] text-[11px] uppercase tracking-[0.28em] text-zinc-500"
                htmlFor="landing-email"
              >
                Work email
              </label>
              <input
                id="landing-email"
                type="text"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-3 min-h-14 w-full rounded-full border border-[color:var(--landing-border)] bg-white/[0.05] px-5 text-base text-[var(--landing-text)] outline-none transition focus:border-[var(--landing-accent)] placeholder:text-zinc-500"
                placeholder={landingCopy.cta.placeholder}
                disabled={isSubmitting}
                aria-describedby="landing-email-status"
                required
              />
            </div>

            <button
              type="submit"
              className="min-h-14 rounded-full border border-[var(--landing-accent)] bg-[var(--landing-accent)] px-6 font-[var(--font-mono)] text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--landing-bg)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Submitting" : landingCopy.cta.eyebrow}
            </button>

            <p className="text-sm leading-6 text-zinc-500">
              {landingCopy.cta.helper}
            </p>

            <p
              id="landing-email-status"
              aria-live="polite"
              className={
                status === "success"
                  ? "text-sm text-[var(--landing-success)]"
                  : status === "error"
                    ? "text-sm text-[var(--landing-loss)]"
                    : "text-sm text-zinc-500"
              }
            >
              {status === "success"
                ? "You are on the list. We will reach out with onboarding details and release updates."
                : status === "error"
                  ? errorMessage
                  : "Desk-grade product updates, routed with restraint."}
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
