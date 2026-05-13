export const landingCopy = {
  nav: {
    home: "Oggregator",
    workflow: "How It Works",
    features: "Features",
    faq: "FAQ",
    cta: "Request Access",
  },
  hero: {
    eyebrow: "Institutional-grade options terminal",
    headline: "The options terminal for fragmented markets.",
    subheadline:
      "Aggregate live venue data, normalize options context, and route with precision from one high-performance workspace.",
    primaryCta: "Request Access",
    secondaryCta: "View Terminal",
    proofLabel: "Live stack",
    proofPoints: [
      "Sub-second refresh",
      "Multi-exchange aggregation",
      "Normalized IV + skew",
      "Command-driven workflows",
    ],
  },
  workflow: {
    eyebrow: "How it works",
    title: "From fragmented feeds to one execution-ready terminal.",
    description:
      "The workflow is designed to reduce switching costs for serious traders: ingest everything once, normalize it fast, and route from one calm operating surface.",
  },
  features: {
    eyebrow: "Core features",
    title: "Fast enough for flow. Structured enough for conviction.",
    description:
      "Every module is tuned for high-utility decision making: speed, comparability, and control without retail dashboard clutter.",
  },
  faq: {
    eyebrow: "FAQ",
    title: "Technical answers before the onboarding call.",
    description:
      "The landing page should convert serious users by answering the real desk questions directly: support, latency, extensibility, and reliability.",
  },
  cta: {
    eyebrow: "Request access",
    title: "Trade from one source of truth.",
    description:
      "Request access to the terminal built for serious options desks. We will use this channel for onboarding, release notes, and technical rollout updates only.",
    placeholder: "desk@fund.com",
    helper: "Early access for desks, market makers, and execution teams.",
    trust: ["Early access", "Technical onboarding", "Desk-grade support"],
  },
  footer: {
    strapline: "Cross-venue options aggregation for serious operators.",
    links: [
      { label: "How It Works", href: "#how-it-works" },
      { label: "Features", href: "#features" },
      { label: "FAQ", href: "#faq" },
      { label: "Access", href: "#access" },
    ],
  },
} as const;

export const heroCopy = {
  eyebrow: landingCopy.hero.eyebrow,
  headlineA: "The options terminal",
  headlineB: "for fragmented markets.",
  cta: landingCopy.hero.primaryCta,
  docs: landingCopy.nav.faq,
} as const;
