import type {
  PaperActivityDto,
  PaperFillDto,
  PaperOrderDto,
  PaperTradeDetailDto,
  PaperWsServerMessage,
} from '@oggregator/protocol';

export type PaperEventListener = (msg: PaperWsServerMessage) => void;

class PaperEventBus {
  private readonly listeners = new Set<PaperEventListener>();

  subscribe(listener: PaperEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitOrder(order: PaperOrderDto, fills: PaperFillDto[]): void {
    this.broadcast({ type: 'order', order, fills });
  }

  emitTrade(trade: PaperTradeDetailDto): void {
    this.broadcast({ type: 'trade', trade });
  }

  emitActivity(activity: PaperActivityDto): void {
    this.broadcast({ type: 'activity', activity });
  }

  private broadcast(msg: PaperWsServerMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(msg);
      } catch {}
    }
  }
}

export const paperEvents = new PaperEventBus();
