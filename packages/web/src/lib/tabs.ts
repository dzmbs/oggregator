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
  badge?: string;
}

export const TABS: readonly TabDef[] = [
  { id: 'chain', label: 'Chain', slug: 'chain' },
  { id: 'alpha', label: 'Alpha', slug: 'alpha', badge: 'NEW' },
  { id: 'architect', label: 'Builder', slug: 'builder' },
  { id: 'trading', label: 'Paper', slug: 'paper' },
  { id: 'portfolio', label: 'Portfolio', slug: 'portfolio', badge: 'NEW' },
  { id: 'surface', label: 'Volatility', slug: 'volatility' },
  { id: 'flow', label: 'Flow', slug: 'flow', badge: 'LIVE' },
  { id: 'analytics', label: 'Analytics', slug: 'analytics' },
  { id: 'gex', label: 'GEX', slug: 'gex' },
] as const;

export const DEFAULT_TAB: TabId = 'chain';

export function tabIdFromSlug(slug: string): TabId | undefined {
  return TABS.find((t) => t.slug === slug)?.id;
}

export function slugFromTabId(id: TabId): string {
  return TABS.find((t) => t.id === id)?.slug ?? TABS[0]!.slug;
}
