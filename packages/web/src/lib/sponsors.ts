export interface Sponsor {
  id: string;
  category: string;
  sponsor: string;
  labels: string[];
  href: string;
}

export const SPONSORS: Sponsor[] = [
  {
    id: 'coincall',
    category: 'SPONSORED',
    sponsor: 'Coincall',
    labels: [
      'Trade options with up to $30K bonus',
      'Low fees + deep options liquidity',
      'Join Coincall — $30K welcome bonus',
    ],
    href: 'https://www.coincall.com/r/43394533',
  },
  {
    id: 'thalex',
    category: 'SPONSORED',
    sponsor: 'Thalex',
    labels: [
      'Get funded — apply to the Thalex Funding Program',
      'Trade options with Thalex funded capital',
      'Prove your edge — Thalex Funding Program',
    ],
    href: 'https://thalex.com/exchange/sign-up?referral=OWNBZS',
  },
];

export const AD_EVERY = 6;
