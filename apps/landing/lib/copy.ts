export const landingCopy = {
  nav: {
    home: 'Oggregator',
    workflow: 'How It Works',
    features: 'Features',
    faq: 'FAQ',
    cta: 'Request Access',
  },
  hero: {
    eyebrow: 'Terminal-first options intelligence',
    headline: 'The landing page now moves like the app.',
    subheadline:
      'Show the real terminal language on the landing page: simulated live surface behavior, real portfolio and chain captures, and the same feed-forward atmosphere traders see in the product.',
    primaryCta: 'Request Access',
    secondaryCta: 'Explore Surface',
    proofLabel: 'App language',
    proofPoints: ['Live surface motion', 'Portfolio preview', 'Chain preview', 'Feed tape'],
  },
  workflow: {
    eyebrow: 'Spatial drill-in',
    title: 'One surface, three disclosure depths.',
    description:
      'The interaction model replaces summary cards with camera states: zoomed-out topology for market regime, regional focus for local structure, and node-locked telemetry for exact execution decisions.',
  },
  features: {
    eyebrow: 'Spatial UX system',
    title: 'Modes, overlays, and clutter control.',
    description:
      'Every overlay earns its place. Height carries IV, color carries change, opacity carries confidence, and motion carries recency so dense options data stays legible under pressure.',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Technical answers before the onboarding call.',
    description:
      'The landing page should convert serious users by answering the real desk questions directly: support, latency, extensibility, and reliability.',
  },
  cta: {
    eyebrow: 'Request access',
    title: 'Trade from one source of truth.',
    description:
      'Request access to the terminal built for serious options desks. We will use this channel for onboarding, release notes, and technical rollout updates only.',
    placeholder: 'desk@fund.com',
    helper: 'Early access for desks, market makers, and execution teams.',
    trust: ['Early access', 'Technical onboarding', 'Desk-grade support'],
  },
  footer: {
    strapline: 'Cross-venue options aggregation for serious operators.',
    links: [
      { label: 'How It Works', href: '#how-it-works' },
      { label: 'Features', href: '#features' },
      { label: 'FAQ', href: '#faq' },
      { label: 'Access', href: '#access' },
    ],
  },
} as const;

export const heroCopy = {
  eyebrow: landingCopy.hero.eyebrow,
  headlineA: 'The options terminal',
  headlineB: 'for fragmented markets.',
  cta: landingCopy.hero.primaryCta,
  docs: landingCopy.nav.faq,
} as const;
