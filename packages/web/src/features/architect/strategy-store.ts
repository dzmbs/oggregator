import { create } from 'zustand';
import type { Leg } from './payoff';

let _nextLegId = 1;

interface StrategyState {
  underlying: string;
  legs: Leg[];
  addLeg: (leg: Omit<Leg, 'id'>, underlying: string) => void;
  removeLeg: (id: string) => void;
  updateLeg: (id: string, patch: Partial<Leg>) => void;
  replaceLegs: (legs: Leg[], underlying: string) => void;
  clearLegs: () => void;
}

export const useStrategyStore = create<StrategyState>((set) => ({
  underlying: '',
  legs: [],

  addLeg: (leg, underlying) =>
    set((s) => {
      const prev = s.underlying === underlying ? s.legs : [];
      return {
        underlying,
        legs: [...prev, { ...leg, id: `leg-${_nextLegId++}` }],
      };
    }),

  removeLeg: (id) =>
    set((s) => ({
      legs: s.legs.filter((l) => l.id !== id),
    })),

  updateLeg: (id, patch) =>
    set((s) => ({
      legs: s.legs.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })),

  replaceLegs: (legs, underlying) => set({ legs, underlying }),

  clearLegs: () => set({ legs: [] }),
}));
