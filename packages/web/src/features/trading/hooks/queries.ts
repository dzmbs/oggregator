import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addTradeNote,
  closeTrade,
  createTrade,
  getActivity,
  getFills,
  getOrders,
  getPaperAccount,
  getOverview,
  getPnl,
  getPositions,
  getTrade,
  getTrades,
  initPaperAccount,
  placeOrder,
  reduceTrade,
} from '../api';

export const QKEY = {
  account: ['paper', 'account'] as const,
  positions: ['paper', 'positions'] as const,
  pnl: ['paper', 'pnl'] as const,
  orders: ['paper', 'orders'] as const,
  overview: ['paper', 'overview'] as const,
  trades: ['paper', 'trades'] as const,
  trade: ['paper', 'trade'] as const,
  activity: ['paper', 'activity'] as const,
  fills: ['paper', 'fills'] as const,
};

function invalidatePaper(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['paper'] });
}

export function usePositions() {
  return useQuery({
    queryKey: QKEY.positions,
    queryFn: getPositions,
    refetchInterval: 5_000,
  });
}

export function usePaperAccount() {
  return useQuery({
    queryKey: QKEY.account,
    queryFn: getPaperAccount,
  });
}

export function usePnl() {
  return useQuery({
    queryKey: QKEY.pnl,
    queryFn: getPnl,
    refetchInterval: 5_000,
  });
}

export function useOrders(limit = 50) {
  return useQuery({
    queryKey: [...QKEY.orders, limit],
    queryFn: () => getOrders(limit),
    refetchInterval: 10_000,
  });
}

export function useOverview() {
  return useQuery({
    queryKey: QKEY.overview,
    queryFn: getOverview,
    refetchInterval: 15_000,
  });
}

export function useTrades(status: 'open' | 'closed' | 'all' = 'all', limit = 100) {
  return useQuery({
    queryKey: [...QKEY.trades, status, limit],
    queryFn: () => getTrades(status, limit),
    refetchInterval: 15_000,
  });
}

export function useTrade(tradeId: string | null) {
  return useQuery({
    queryKey: [...QKEY.trade, tradeId],
    queryFn: () => getTrade(tradeId!),
    enabled: tradeId != null,
    refetchInterval: 15_000,
  });
}

export function useActivity(limit = 100, tradeId?: string) {
  return useQuery({
    queryKey: [...QKEY.activity, limit, tradeId ?? 'all'],
    queryFn: () => getActivity(limit, tradeId),
    refetchInterval: 15_000,
  });
}

export function useFills(limit = 100, tradeId?: string) {
  return useQuery({
    queryKey: [...QKEY.fills, limit, tradeId ?? 'all'],
    queryFn: () => getFills(limit, tradeId),
    refetchInterval: 15_000,
  });
}

export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: placeOrder,
    onSuccess: () => {
      invalidatePaper(qc);
    },
  });
}

export function useCreateTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTrade,
    onSuccess: (result) => {
      qc.setQueryData([...QKEY.trade, result.trade.id], result.trade);
      invalidatePaper(qc);
    },
  });
}

export function useAddTradeNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tradeId, content }: { tradeId: string; content: Parameters<typeof addTradeNote>[1] }) =>
      addTradeNote(tradeId, content),
    onSuccess: (trade) => {
      qc.setQueryData([...QKEY.trade, trade.id], trade);
      invalidatePaper(qc);
    },
  });
}

export function useCloseTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: closeTrade,
    onSuccess: (trade) => {
      qc.setQueryData([...QKEY.trade, trade.id], trade);
      invalidatePaper(qc);
    },
  });
}

export function useReduceTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tradeId, fraction }: { tradeId: string; fraction: number }) =>
      reduceTrade(tradeId, fraction),
    onSuccess: (trade) => {
      qc.setQueryData([...QKEY.trade, trade.id], trade);
      invalidatePaper(qc);
    },
  });
}

export function useInitPaperAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: initPaperAccount,
    onSuccess: (account) => {
      qc.setQueryData(QKEY.account, account);
      invalidatePaper(qc);
    },
  });
}
