'use client';

import * as React from 'react';

import { leadSchema } from '@/lib/lead-schema';

const leadSource = 'landing-hero';

export function LeadCaptureSection() {
  const [email, setEmail] = React.useState('');
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = React.useState('');

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = leadSchema.safeParse({
      email,
      source: leadSource,
    });

    if (!parsed.success) {
      setStatus('error');
      setErrorMessage('Enter a valid work email address.');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        setStatus('error');
        setErrorMessage('Submission failed. Try again shortly.');
        return;
      }

      setStatus('success');
      setErrorMessage('');
      setEmail('');
    } catch {
      setStatus('error');
      setErrorMessage('Submission failed. Try again shortly.');
    }
  }

  const isSubmitting = status === 'loading';

  return (
    <section className="mx-auto max-w-7xl px-6 py-24 sm:px-10">
      <div className="grid gap-10 rounded-[2.5rem] border border-white/6 bg-[var(--landing-panel)] px-8 py-10 shadow-[0_25px_80px_rgba(0,0,0,0.28)] lg:grid-cols-[1.05fr_0.95fr] lg:px-12 lg:py-14">
        <div className="max-w-2xl">
          <p className="font-[var(--font-mono)] text-[11px] uppercase tracking-[0.34em] text-[var(--landing-accent)]">
            Request access
          </p>
          <h2 className="mt-5 font-[var(--font-heading)] text-5xl font-black leading-[0.92] tracking-[-0.06em] md:text-7xl">
            Keep the desk loop tight.
          </h2>
          <p className="mt-8 text-lg leading-8 text-zinc-400">
            Receive measured product updates, release notes, and early access notices for the
            options aggregation workflow.
          </p>
          <p className="mt-4 text-lg leading-8 text-zinc-400">
            We only use this channel for platform updates and onboarding into the Oggregator funnel.
          </p>
        </div>

        <div className="rounded-[2rem] border border-white/6 bg-[var(--landing-panel-strong)] p-6">
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
                className="mt-3 min-h-14 w-full rounded-full border border-white/10 bg-white/5 px-5 text-base text-[var(--landing-text)] outline-none transition focus:border-[var(--landing-accent)] placeholder:text-zinc-500"
                placeholder="desk@fund.com"
                disabled={isSubmitting}
                aria-describedby="landing-email-status"
                required
              />
            </div>

            <button
              type="submit"
              className="min-h-14 rounded-full border border-[var(--landing-accent)] bg-[var(--landing-accent)] px-6 font-[var(--font-mono)] text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Submitting' : 'Request Access'}
            </button>

            <p className="text-sm leading-6 text-zinc-500">
              Serious inquiries only. No broadcast list, no market noise.
            </p>

            <p
              id="landing-email-status"
              aria-live="polite"
              className={
                status === 'success'
                  ? 'text-sm text-emerald-400'
                  : status === 'error'
                    ? 'text-sm text-rose-400'
                    : 'text-sm text-zinc-500'
              }
            >
              {status === 'success'
                ? 'You are on the list. We will reach out with product updates and access.'
                : status === 'error'
                  ? errorMessage
                  : 'Desk-grade product updates, routed with restraint.'}
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
