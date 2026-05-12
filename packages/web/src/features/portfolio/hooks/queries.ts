import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  PositionLegInput,
  VolShockScenario,
} from '@oggregator/protocol';

import {
  addPosition,
  fetchMetrics,
  fetchPositions,
  removePosition,
  runScenarios,
  type PortfolioSource,
} from '../api';

export const PORTFOLIO_QKEY = {
  positions: (source: PortfolioSource) => ['portfolio', 'positions', source] as const,
  metrics: (forwardDays: number, source: PortfolioSource) =>
    ['portfolio', 'metrics', forwardDays, source] as const,
};

export function usePortfolioPositions(source: PortfolioSource = 'manual') {
  return useQuery({
    queryKey: PORTFOLIO_QKEY.positions(source),
    queryFn: () => fetchPositions(source),
    refetchInterval: 5_000,
  });
}

export function usePortfolioMetrics(forwardDays: number, source: PortfolioSource = 'manual') {
  return useQuery({
    queryKey: PORTFOLIO_QKEY.metrics(forwardDays, source),
    queryFn: () => fetchMetrics(forwardDays, source),
    refetchInterval: 5_000,
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

export function useRunScenarios(source: PortfolioSource = 'manual') {
  return useMutation({
    mutationFn: (scenarios: VolShockScenario[]) => runScenarios(scenarios, source),
  });
}
