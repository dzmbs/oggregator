import { z } from 'zod';

import { VenueIdSchema, type VenueId } from './ws.js';

export const VenueCredentialFieldKeySchema = z.enum([
  'apiKey',
  'apiSecret',
  'passphrase',
  'clientId',
  'clientSecret',
  'subaccountId',
  'account',
  'walletAddress',
  'privateKeyPem',
  'kid',
]);
export type VenueCredentialFieldKey = z.infer<typeof VenueCredentialFieldKeySchema>;

export const VenueCredentialFieldSpecSchema = z.object({
  key: VenueCredentialFieldKeySchema,
  label: z.string(),
  placeholder: z.string().optional(),
  secret: z.boolean(),
  required: z.boolean(),
  multiline: z.boolean().optional(),
});
export type VenueCredentialFieldSpec = z.infer<typeof VenueCredentialFieldSpecSchema>;

export const VenuePrivateAdapterStatusSchema = z.enum(['planned', 'in_progress', 'available']);
export type VenuePrivateAdapterStatus = z.infer<typeof VenuePrivateAdapterStatusSchema>;

export const VenuePrivateAdapterSpecSchema = z.object({
  venue: VenueIdSchema,
  status: VenuePrivateAdapterStatusSchema,
  wsEndpoint: z.string(),
  authScheme: z.enum(['hmac', 'jwt-rs512', 'oauth-client-credentials', 'eip712', 'listen-key']),
  positionChannels: z.array(z.string()),
  subscribeMethod: z.string(),
  docsUrl: z.string(),
  credentialFields: z.array(VenueCredentialFieldSpecSchema),
  todos: z.array(z.string()),
});
export type VenuePrivateAdapterSpec = z.infer<typeof VenuePrivateAdapterSpecSchema>;

export const VenueCredentialsSchema = z.object({
  venue: VenueIdSchema,
  label: z.string().optional(),
  fields: z.record(VenueCredentialFieldKeySchema, z.string()),
  addedAt: z.number().int().nonnegative(),
});
export type VenueCredentials = z.infer<typeof VenueCredentialsSchema>;

const COMMON_KEY: VenueCredentialFieldSpec = {
  key: 'apiKey',
  label: 'API key',
  placeholder: 'api_…',
  secret: false,
  required: true,
};

const COMMON_SECRET: VenueCredentialFieldSpec = {
  key: 'apiSecret',
  label: 'API secret',
  placeholder: '••••••••',
  secret: true,
  required: true,
};

export const PRIVATE_ADAPTER_SPECS: Readonly<Record<VenueId, VenuePrivateAdapterSpec>> = {
  deribit: {
    venue: 'deribit',
    status: 'planned',
    wsEndpoint: 'wss://www.deribit.com/ws/api/v2',
    authScheme: 'oauth-client-credentials',
    subscribeMethod: 'private/subscribe',
    positionChannels: ['user.portfolio.btc', 'user.portfolio.eth', 'user.changes.option.any.raw'],
    docsUrl: 'https://docs.deribit.com/#authentication',
    credentialFields: [
      {
        key: 'clientId',
        label: 'Client ID',
        placeholder: 'XXxxXXxx',
        secret: false,
        required: true,
      },
      {
        key: 'clientSecret',
        label: 'Client secret',
        placeholder: '••••••••',
        secret: true,
        required: true,
      },
    ],
    todos: [
      'create packages/core/src/feeds/deribit-private/ws-client.ts wrapping JsonRpcWsClient',
      'implement public/auth with grant_type=client_credentials → token cache + refresh',
      'subscribe to user.portfolio.{BTC,ETH} and user.changes.option.any.raw',
      'map portfolio payload → PositionLeg (deribit uses size as contracts)',
      'expose as PortfolioSource via portfolio-services.ts (extend PortfolioSource to "deribit")',
    ],
  },
  okx: {
    venue: 'okx',
    status: 'planned',
    wsEndpoint: 'wss://ws.okx.com:8443/ws/v5/private',
    authScheme: 'hmac',
    subscribeMethod: 'subscribe',
    positionChannels: ['positions'],
    docsUrl: 'https://www.okx.com/docs-v5/en/#overview-websocket-login',
    credentialFields: [
      COMMON_KEY,
      COMMON_SECRET,
      {
        key: 'passphrase',
        label: 'Passphrase',
        placeholder: 'set when creating the OKX API key',
        secret: true,
        required: true,
      },
    ],
    todos: [
      'create packages/core/src/feeds/okx-private/ws-client.ts using TopicWsClient',
      'login op: { args: [{ apiKey, passphrase, timestamp, sign }] } where sign = HMAC-SHA256(secret, ts + "GET" + "/users/self/verify")',
      'subscribe to channel "positions" filtered by instType=OPTION',
      'normalize OKX position fields (pos, avgPx) → PositionLeg',
      'add "okx" to PortfolioSource enum',
    ],
  },
  binance: {
    venue: 'binance',
    status: 'planned',
    wsEndpoint: 'wss://nbstream.binance.com/eoptions/ws/{listenKey}',
    authScheme: 'listen-key',
    subscribeMethod: 'POST /eapi/v1/userDataStream (REST) then connect WS to /eoptions/ws/{key}',
    positionChannels: ['ACCOUNT_UPDATE', 'EXECUTION_REPORT'],
    docsUrl: 'https://developers.binance.com/docs/derivatives/option/user-data-streams',
    credentialFields: [COMMON_KEY, COMMON_SECRET],
    todos: [
      'create packages/core/src/feeds/binance-private/listen-key-manager.ts (30-min keepalive PUT)',
      'create packages/core/src/feeds/binance-private/ws-client.ts',
      'POST /eapi/v1/userDataStream with X-MBX-APIKEY → listenKey',
      'open WS at /eoptions/ws/{listenKey}, no client-side subscribe needed',
      'GET /eapi/v1/position with HMAC-SHA256(secret, queryString) for initial snapshot',
      'add "binance" to PortfolioSource enum',
    ],
  },
  bybit: {
    venue: 'bybit',
    status: 'planned',
    wsEndpoint: 'wss://stream.bybit.com/v5/private',
    authScheme: 'hmac',
    subscribeMethod: 'subscribe',
    positionChannels: ['position'],
    docsUrl: 'https://bybit-exchange.github.io/docs/v5/ws/connect#authentication',
    credentialFields: [COMMON_KEY, COMMON_SECRET],
    todos: [
      'create packages/core/src/feeds/bybit-private/ws-client.ts using TopicWsClient',
      'auth op: { op: "auth", args: [apiKey, expires, sign] } where sign = HMAC-SHA256(secret, "GET/realtime" + expires)',
      'app-level ping required (existing bybit gotcha — { op: "ping" })',
      'subscribe to "position" with category=option',
      'normalize Bybit position fields → PositionLeg',
      'add "bybit" to PortfolioSource enum',
    ],
  },
  derive: {
    venue: 'derive',
    status: 'available',
    wsEndpoint: 'wss://api.lyra.finance/ws',
    authScheme: 'eip712',
    subscribeMethod: 'subscribe',
    positionChannels: ['{subaccount_id}.positions'],
    docsUrl: 'https://docs.derive.xyz/reference/private-login',
    credentialFields: [
      {
        key: 'walletAddress',
        label: 'Wallet address',
        placeholder: '0x…',
        secret: false,
        required: true,
      },
      {
        key: 'privateKeyPem',
        label: 'Session signing key',
        placeholder: '0x… (32-byte hex private key)',
        secret: true,
        required: true,
      },
      {
        key: 'subaccountId',
        label: 'Subaccount ID',
        placeholder: 'numeric',
        secret: false,
        required: true,
      },
    ],
    todos: [
      'create packages/core/src/feeds/derive-private/ws-client.ts using JsonRpcWsClient (subscribe method)',
      'public/login with EIP-712 signed message (timestamp + wallet)',
      'subscribe to "{subaccount_id}.positions" channel',
      'use api.lyra.finance (not api.derive.xyz — DNS gotcha)',
      'normalize Derive numeric-as-string position fields',
      'add "derive" to PortfolioSource enum',
    ],
  },
  coincall: {
    venue: 'coincall',
    status: 'planned',
    wsEndpoint: 'wss://ws.coincall.com/options/private',
    authScheme: 'hmac',
    subscribeMethod: 'subscribe',
    positionChannels: ['position'],
    docsUrl: 'https://docs.coincall.com/#websocket-authentication',
    credentialFields: [COMMON_KEY, COMMON_SECRET],
    todos: [
      'create packages/core/src/feeds/coincall-private/ws-client.ts',
      'sign WS auth payload with HMAC-SHA256(secret, "GET" + path + ts)',
      'subscribe to "position" channel for options',
      'normalize Coincall position payload → PositionLeg',
      'add "coincall" to PortfolioSource enum',
    ],
  },
  thalex: {
    venue: 'thalex',
    status: 'available',
    wsEndpoint: 'wss://thalex.com/ws/api/v2',
    authScheme: 'jwt-rs512',
    subscribeMethod: 'private/subscribe',
    positionChannels: ['account.portfolio', 'account.summary'],
    docsUrl: 'https://thalex.com/docs/#tag/rpc_accounting',
    credentialFields: [
      {
        key: 'kid',
        label: 'Key ID (kid)',
        placeholder: 'from thalex dashboard',
        secret: false,
        required: true,
      },
      {
        key: 'privateKeyPem',
        label: 'RSA private key (PEM)',
        placeholder: '-----BEGIN RSA PRIVATE KEY-----\n…',
        secret: true,
        required: true,
        multiline: true,
      },
      {
        key: 'account',
        label: 'Account number',
        placeholder: 'optional: connect a non-default account',
        secret: false,
        required: false,
      },
    ],
    todos: [
      'add jsonwebtoken + @types/jsonwebtoken to packages/core/package.json',
      'create packages/core/src/feeds/thalex-private/auth.ts: mintAuthToken({ kid, privateKeyPem }) using RS512',
      'create packages/core/src/feeds/thalex-private/ws-client.ts wrapping JsonRpcWsClient with subscribeMethod="private/subscribe"',
      'public/login({ token, account? }) then private/subscribe(["account.portfolio","account.summary"])',
      'reuse instrument-name parser from feeds/thalex/codec.ts',
      'add "thalex" to PortfolioSource enum',
      'gate behind THALEX_PRIVATE_ENABLED env flag until ready',
    ],
  },
  gateio: {
    venue: 'gateio',
    status: 'planned',
    wsEndpoint: 'wss://op-ws.gateio.live/v4/ws/usdt',
    authScheme: 'hmac',
    subscribeMethod: 'subscribe',
    positionChannels: ['options.positions'],
    docsUrl: 'https://www.gate.com/docs/developers/options/ws/en/',
    credentialFields: [COMMON_KEY, COMMON_SECRET],
    todos: [
      'create packages/core/src/feeds/gateio-private/ws-client.ts using TopicWsClient',
      'sign auth op: { time, channel: "options.login", event: "api", payload: [{ api_key, timestamp, sign }] } where sign = HMAC-SHA256(secret, channel + "\\n" + event + "\\n" + timestamp)',
      'subscribe to options.positions channel after auth',
      'normalize Gate position fields (size, entry_price) → PositionLeg',
      'add "gateio" to PortfolioSource enum',
    ],
  },
};
