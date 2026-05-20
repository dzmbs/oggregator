import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PositionLegInput } from '@oggregator/protocol';

import {
  addPosition,
  fetchMetrics,
  fetchPositions,
  removePosition,
  type PortfolioSource,
} from '../api';

export const PORTFOLIO_QKEY = {
  positions: (source: PortfolioSource, underlying?: string) =>
    ['portfolio', 'positions', source, underlying ?? 'all'] as const,
  metrics: (forwardDays: number, source: PortfolioSource, underlying?: string) =>
    ['portfolio', 'metrics', forwardDays, source, underlying ?? 'all'] as const,
};

export function usePortfolioPositions(
  source: PortfolioSource = 'manual',
  options?: { wsLive?: boolean; underlying?: string },
) {
  return useQuery({
    queryKey: PORTFOLIO_QKEY.positions(source, options?.underlying),
    queryFn: () => fetchPositions(source, options?.underlying),
    refetchInterval: options?.wsLive === true ? false : 5_000,
  });
}

export function usePortfolioMetrics(
  forwardDays: number,
  source: PortfolioSource = 'manual',
  options?: { wsLive?: boolean; underlying?: string },
) {
  return useQuery({
    queryKey: PORTFOLIO_QKEY.metrics(forwardDays, source, options?.underlying),
    queryFn: () => fetchMetrics(forwardDays, source, options?.underlying),
    refetchInterval: options?.wsLive === true ? false : 5_000,
  });
}

export function useAddPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PositionLegInput) => addPosition(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });
}

export function useRemovePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (legId: string) => removePosition(legId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });
}

