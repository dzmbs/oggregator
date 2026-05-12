"use client";

import { useState } from "react";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LeadCaptureSection() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!emailPattern.test(email)) {
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
        body: JSON.stringify({
          email,
          source: "landing-hero",
        }),
      });

      if (!response.ok) {
        setStatus("error");
        setErrorMessage("Submission failed. Try again.");
        return;
      }

      setStatus("success");
      setEmail("");
    } catch {
      setStatus("error");
      setErrorMessage("Submission failed. Try again.");
    }
  }

  return (
    <section className="mx-auto max-w-4xl px-6 py-24 text-center sm:px-10">
      <p className="mb-8 font-[var(--font-mono)] text-xs uppercase tracking-[0.45em] text-[var(--landing-accent)]">
        Request access
      </p>
      <h2 className="font-[var(--font-heading)] text-5xl font-black tracking-[-0.06em] md:text-7xl">
        Get product updates and access.
      </h2>
      <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-zinc-400">
        Get product drops, desk notes, and early access to the options
        aggregator.
      </p>
      <form
        onSubmit={onSubmit}
        className="mx-auto mt-10 flex max-w-xl flex-col gap-4 sm:flex-row"
      >
        <label className="sr-only" htmlFor="landing-email">
          Email
        </label>
        <input
          id="landing-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="min-h-14 flex-1 rounded-full border border-white/10 bg-white/5 px-6 text-zinc-50 outline-none placeholder:text-zinc-500"
          placeholder="desk@fund.com"
          autoComplete="email"
          required
        />
        <button
          type="submit"
          className="min-h-14 rounded-full border border-white/10 bg-[var(--landing-accent)] px-8 font-[var(--font-mono)] text-sm font-semibold uppercase tracking-[0.18em] text-slate-950"
        >
          {status === "loading" ? "Submitting" : "Request Access"}
        </button>
      </form>
      {status === "success" && (
        <p className="mt-6 text-sm text-emerald-400">You are on the list.</p>
      )}
      {status === "error" && errorMessage && (
        <p className="mt-6 text-sm text-rose-400">{errorMessage}</p>
      )}
    </section>
  );
}
