export type TabId =
  | 'chain'
  | 'alpha'
  | 'architect'
  | 'trading'
  | 'portfolio'
  | 'surface'
  | 'flow'
  | 'analytics'
  | 'gex';

export interface TabDef {
  id: TabId;
  label: string;
  slug: string;
  icon: string;
  badge?: string;
}

export const TABS: readonly TabDef[] = [
  { id: 'chain', label: 'Chain', slug: 'chain', icon: '⟐' },
  { id: 'alpha', label: 'Alpha', slug: 'alpha', icon: 'α', badge: 'NEW' },
  { id: 'architect', label: 'Builder', slug: 'builder', icon: '⚙' },
  { id: 'trading', label: 'Paper', slug: 'paper', icon: '$' },
  { id: 'portfolio', label: 'Portfolio', slug: 'portfolio', icon: 'Σ', badge: 'NEW' },
  { id: 'surface', label: 'Volatility', slug: 'volatility', icon: '◈' },
  { id: 'flow', label: 'Flow', slug: 'flow', icon: '⚡', badge: 'LIVE' },
  { id: 'analytics', label: 'Analytics', slug: 'analytics', icon: '◎' },
  { id: 'gex', label: 'GEX', slug: 'gex', icon: '▧' },
] as const;

export const DEFAULT_TAB: TabId = 'chain';

export function tabIdFromSlug(slug: string): TabId | undefined {
  return TABS.find((t) => t.slug === slug)?.id;
}

export function slugFromTabId(id: TabId): string {
  return TABS.find((t) => t.id === id)?.slug ?? TABS[0]!.slug;
}
