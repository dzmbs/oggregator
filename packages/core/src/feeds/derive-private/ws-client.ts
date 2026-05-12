import { feedLogger } from '../../utils/logger.js';
import { JsonRpcWsClient } from '../shared/jsonrpc-client.js';
import { signLoginMessage } from './auth.js';
import { derivePositionsToLegs } from './codec.js';
import { DerivePositionsResponseSchema, type DerivePosition } from './types.js';
import type { PositionLeg } from '@oggregator/protocol';

const DERIVE_WS_URL = 'wss://api.lyra.finance/ws';
const DERIVE_TESTNET_WS_URL = 'wss://api-demo.lyra.finance/ws';

export interface DerivePrivateCreds {
  walletAddress: string;
  signerPrivateKey: string;
  subaccountId: number;
  env?: 'prod' | 'test';
}

export type DerivePositionsListener = (legs: PositionLeg[]) => void;

export class DerivePrivateClient {
  private readonly client: JsonRpcWsClient;
  private readonly listeners = new Set<DerivePositionsListener>();
  private latestLegs: PositionLeg[] = [];
  private refreshInFlight: Promise<void> | null = null;
  private disposed = false;
  private readonly log = feedLogger('derive-private');

  constructor(private readonly creds: DerivePrivateCreds) {
    const url = creds.env === 'test' ? DERIVE_TESTNET_WS_URL : DERIVE_WS_URL;
    this.client = new JsonRpcWsClient(url, 'derive-private', {
      subscribeMethod: 'subscribe',
      unsubscribeMethod: 'unsubscribe',
      heartbeatIntervalSec: 30,
      onStatusChange: (state) => {
        if (state === 'connected') {
          void this.afterReconnect();
        }
      },
    });
    this.client.onSubscription((channel, _data) => {
      if (channel === this.balanceChannel()) {
        void this.refreshPositions();
      }
    });
  }

  async start(): Promise<void> {
    await this.client.connect();
    await this.login();
    await this.client.subscribe([this.balanceChannel()], 'derive-private');
    await this.refreshPositions();
  }

  subscribe(listener: DerivePositionsListener): () => void {
    this.listeners.add(listener);
    if (this.latestLegs.length > 0) {
      try {
        listener(this.latestLegs);
      } catch {}
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  getLatestLegs(): PositionLeg[] {
    return [...this.latestLegs];
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.listeners.clear();
    await this.client.disconnect();
  }

  private balanceChannel(): string {
    return `${this.creds.subaccountId}.balances`;
  }

  private async login(): Promise<void> {
    const params = signLoginMessage({
      walletAddress: this.creds.walletAddress,
      signerPrivateKey: this.creds.signerPrivateKey,
    });
    await this.client.call('public/login', { ...params });
    this.log.info({ subaccount: this.creds.subaccountId }, 'derive private login ok');
  }

  private async afterReconnect(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.login();
      await this.client.subscribe([this.balanceChannel()], 'derive-reconnect');
      await this.refreshPositions();
    } catch (err) {
      this.log.warn({ err: String(err) }, 'derive private reconnect failed');
    }
  }

  private async refreshPositions(): Promise<void> {
    if (this.refreshInFlight != null) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        const raw = await this.client.call('private/get_positions', {
          subaccount_id: this.creds.subaccountId,
        });
        const parsed = DerivePositionsResponseSchema.safeParse(raw);
        if (!parsed.success) {
          this.log.warn({ err: parsed.error.message }, 'derive positions parse failed');
          return;
        }
        const legs = derivePositionsToLegs(parsed.data.positions as DerivePosition[]);
        this.latestLegs = legs;
        for (const listener of this.listeners) {
          try {
            listener(legs);
          } catch {}
        }
      } catch (err) {
        this.log.warn({ err: String(err) }, 'derive positions refresh failed');
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }
}
