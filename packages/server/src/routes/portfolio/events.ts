import { logger } from '@oggregator/core';
import type { PortfolioWsServerMessage } from '@oggregator/protocol';

type Listener = (msg: PortfolioWsServerMessage) => void;

class PortfolioEventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(accountId: string, listener: Listener): () => void {
    let set = this.listeners.get(accountId);
    if (set == null) {
      set = new Set();
      this.listeners.set(accountId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(accountId);
    };
  }

  emit(accountId: string, msg: PortfolioWsServerMessage): void {
    const set = this.listeners.get(accountId);
    if (set == null) return;
    for (const listener of set) {
      try {
        listener(msg);
      } catch (err) {
        logger.error(
          { err, accountId, msgType: msg.type },
          'portfolio event bus listener failed',
        );
      }
    }
  }
}

export const portfolioEvents = new PortfolioEventBus();
