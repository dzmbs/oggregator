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
} from '../api';

export const PORTFOLIO_QKEY = {
  positions: ['portfolio', 'positions'] as const,
  metrics: (forwardDays: number) => ['portfolio', 'metrics', forwardDays] as const,
};

export function usePortfolioPositions() {
  return useQuery({
    queryKey: PORTFOLIO_QKEY.positions,
    queryFn: fetchPositions,
    refetchInterval: 5_000,
  });
}

export function usePortfolioMetrics(forwardDays: number) {
  return useQuery({
    queryKey: PORTFOLIO_QKEY.metrics(forwardDays),
    queryFn: () => fetchMetrics(forwardDays),
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

export function useRunScenarios() {
  return useMutation({
    mutationFn: (scenarios: VolShockScenario[]) => runScenarios(scenarios),
  });
}
