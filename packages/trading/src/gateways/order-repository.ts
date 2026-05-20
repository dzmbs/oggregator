import type { Order, OrderId } from '../book/order.js';
import type { Fill } from '../book/fill.js';
import type { AccountId } from '../book/account.js';

export interface OrderRepository {
  saveOrder(order: Order): Promise<void>;
  updateOrderStatus(order: Order): Promise<void>;
  saveFills(fills: Fill[]): Promise<void>;
  getOrder(id: OrderId): Promise<Order | null>;
  listOrders(accountId: AccountId, limit: number): Promise<Order[]>;
  listFills(accountId: AccountId, limit: number): Promise<Fill[]>;
}
