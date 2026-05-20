export const landingCopy = {
  nav: {
    home: 'Oggregator',
    workflow: 'Terminal',
    features: 'Features',
    faq: 'FAQ',
    cta: 'Request Access',
  },
  hero: {
    eyebrow: 'Cross-venue options terminal',
    headline: 'One terminal. Every venue.',
    subheadline:
      'Trade options across Deribit, OKX, Binance, Bybit, Thalex, Derive, Coincall, and Gate.io — from a single surface.',
    primaryCta: 'Request Access',
    secondaryCta: 'See the terminal',
    proofLabel: 'Connected venues',
    proofPoints: ['Deribit', 'OKX', 'Binance', 'Bybit'],
  },
  workflow: {
    eyebrow: 'The terminal',
    title: 'Surface. Chain. Portfolio.',
    description: 'One workspace. Every screen the desk runs.',
  },
  showcase: {
    eyebrow: 'Inside the terminal',
    title: 'Built for cross-venue flow.',
    description: 'Every screen, one source of truth.',
  },
  features: {
    eyebrow: 'Built for desks',
    title: 'Cross-venue from the first quote.',
    description: 'Normalized prices. Sub-second refresh. Venue-aware routing.',
  },
  venues: {
    eyebrow: 'Connected venues',
    title: 'Eight markets. One terminal.',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Answers before the call.',
    description: 'What desks ask before onboarding.',
  },
  cta: {
    eyebrow: 'Request access',
    title: 'One source of truth.',
    description: 'For desks, market makers, and execution teams.',
    placeholder: 'desk@fund.com',
    helper: 'Early access. No newsletter.',
    trust: ['Early access', 'Desk-grade support', 'Sub-second feeds'],
  },
  footer: {
    strapline: 'Cross-venue options aggregation.',
    links: [
      { label: 'Terminal', href: '#how-it-works' },
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
