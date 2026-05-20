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
    <section
      id="access"
      className="relative isolate overflow-hidden border-y border-white/8 bg-[#0a0c0f]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_18%,_rgba(237,244,246,0.10),_transparent_38%),_radial-gradient(circle_at_92%_84%,_rgba(237,244,246,0.06),_transparent_40%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:140px_140px] opacity-25"
      />

      <div className="landing-container relative px-6 py-24 sm:px-10 sm:py-32">
        <header className="flex flex-col gap-6 border-b border-white/10 pb-10 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
          <div className="flex items-baseline gap-4">
            <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-[var(--landing-accent)]">
              ◢ {landingCopy.cta.eyebrow.toLowerCase()}
            </span>
            <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-zinc-600">
              channel · onboarding only
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
            {landingCopy.cta.trust.map((item, index) => (
              <span key={item} className="flex items-center gap-2">
                <span className="text-zinc-600">{`0${index + 1}`}</span>
                <span className="text-zinc-300">{item}</span>
              </span>
            ))}
          </div>
        </header>

        <div className="mt-12 grid gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
          <div>
            <h2 className="font-[var(--font-heading)] text-[clamp(3rem,7.4vw,6.4rem)] font-medium leading-[0.9] tracking-[-0.055em] text-[var(--landing-text-strong)] [text-wrap:balance]">
              {landingCopy.cta.title}
            </h2>
            <p className="mt-8 max-w-xl text-[1.05rem] leading-8 text-[var(--landing-muted-strong)]">
              {landingCopy.cta.description}
            </p>

            <div className="mt-10 grid max-w-xl grid-cols-3 gap-6 border-t border-white/8 pt-6 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.28em]">
              <div>
                <p className="text-zinc-600">desk routing</p>
                <p className="mt-2 text-[var(--landing-text-strong)]">07 venues</p>
              </div>
              <div>
                <p className="text-zinc-600">refresh</p>
                <p className="mt-2 text-[var(--landing-text-strong)]">sub-second</p>
              </div>
              <div>
                <p className="text-zinc-600">support</p>
                <p className="mt-2 text-[var(--landing-text-strong)]">desk-grade</p>
              </div>
            </div>
          </div>

          <div>
            <form
              className="flex flex-col"
              noValidate
              onSubmit={onSubmit}
            >
              <label
                className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.32em] text-zinc-500"
                htmlFor="landing-email"
              >
                ◢ work email
              </label>

              <div className="mt-4 grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-white/15 pb-4 transition focus-within:border-[var(--landing-accent)]">
                <span
                  aria-hidden
                  className="font-[var(--font-mono)] text-base text-[var(--landing-accent)]"
                >
                  &gt;
                </span>
                <input
                  id="landing-email"
                  type="text"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (status !== "idle" && status !== "loading") {
                      setStatus("idle");
                      setErrorMessage("");
                    }
                  }}
                  className="w-full bg-transparent font-[var(--font-mono)] text-xl text-[var(--landing-text-strong)] outline-none placeholder:text-zinc-600 sm:text-2xl"
                  placeholder={landingCopy.cta.placeholder}
                  disabled={isSubmitting}
                  aria-describedby="landing-email-status"
                  required
                />
                <span
                  aria-hidden
                  className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.3em] text-zinc-600"
                >
                  {email.length > 0 ? `${email.length} c` : "—"}
                </span>
              </div>

              <button
                type="submit"
                className="mt-8 flex items-center justify-between gap-4 self-start border border-[var(--landing-accent)] bg-[var(--landing-accent)] px-8 py-5 font-[var(--font-mono)] text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--landing-bg)] transition hover:translate-x-1 hover:bg-[#ffffff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--landing-accent)] disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isSubmitting}
              >
                <span>{isSubmitting ? "Submitting" : landingCopy.cta.eyebrow}</span>
                <span aria-hidden className="text-base">→</span>
              </button>

              <p className="mt-6 max-w-md font-[var(--font-mono)] text-[10px] uppercase leading-5 tracking-[0.24em] text-zinc-500">
                {landingCopy.cta.helper}
              </p>

              <p
                id="landing-email-status"
                aria-live="polite"
                className={
                  status === "success"
                    ? "mt-6 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.3em] text-[var(--landing-success)]"
                    : status === "error"
                      ? "mt-6 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.3em] text-[var(--landing-loss)]"
                      : "mt-6 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.28em] text-zinc-600"
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

        <div className="mt-16 flex flex-wrap items-center justify-between gap-6 border-t border-white/8 pt-6 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.32em] text-zinc-600">
          <span>access.oggregator</span>
          <span>built for desks · market makers · execution teams</span>
        </div>
      </div>
    </section>
  );
}
