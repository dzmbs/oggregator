import {
  ThalexIndexNotificationSchema,
  ThalexInstrumentsResponseSchema,
  ThalexRpcErrorSchema,
  ThalexSubscribeAckSchema,
  ThalexSystemInfoSchema,
  ThalexTickerNotificationSchema,
  type ThalexIndexNotification,
  type ThalexInstrumentsResponse,
  type ThalexRpcError,
  type ThalexSubscribeAck,
  type ThalexSystemInfo,
  type ThalexTickerNotification,
} from './types.js';

export function parseThalexInstruments(input: unknown): ThalexInstrumentsResponse | null {
  const parsed = ThalexInstrumentsResponseSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseThalexSystemInfo(input: unknown): ThalexSystemInfo | null {
  const parsed = ThalexSystemInfoSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseThalexTickerNotification(input: unknown): ThalexTickerNotification | null {
  const parsed = ThalexTickerNotificationSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseThalexIndexNotification(input: unknown): ThalexIndexNotification | null {
  const parsed = ThalexIndexNotificationSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseThalexSubscribeAck(input: unknown): ThalexSubscribeAck | null {
  const parsed = ThalexSubscribeAckSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseThalexRpcError(input: unknown): ThalexRpcError | null {
  const parsed = ThalexRpcErrorSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export type ThalexWsDispatch =
  | { kind: 'ticker'; message: ThalexTickerNotification }
  | { kind: 'index'; message: ThalexIndexNotification }
  | { kind: 'ack'; message: ThalexSubscribeAck }
  | { kind: 'error'; message: ThalexRpcError }
  | { kind: 'unknown'; raw: unknown };

// Thalex WS frames come in four shapes:
//   - notification: { channel_name, notification, snapshot? }
//   - ack:          { id, result: string[] }
//   - error:        { id, error: {code, message} }
//   - other:        anything else (e.g. the system channel's payload)
// This dispatcher routes by the cheapest shape check first.
export function parseThalexWsMessage(input: unknown): ThalexWsDispatch {
  if (input == null || typeof input !== 'object') return { kind: 'unknown', raw: input };
  const obj = input as Record<string, unknown>;

  const channelName = obj['channel_name'];
  if (typeof channelName === 'string') {
    if (channelName.startsWith('ticker.')) {
      const msg = parseThalexTickerNotification(input);
      if (msg) return { kind: 'ticker', message: msg };
    } else if (channelName.startsWith('price_index.')) {
      const msg = parseThalexIndexNotification(input);
      if (msg) return { kind: 'index', message: msg };
    }
    return { kind: 'unknown', raw: input };
  }

  if ('error' in obj && obj['error'] != null) {
    const msg = parseThalexRpcError(input);
    if (msg) return { kind: 'error', message: msg };
  }

  if ('result' in obj) {
    const msg = parseThalexSubscribeAck(input);
    if (msg) return { kind: 'ack', message: msg };
  }

  return { kind: 'unknown', raw: input };
}
