import { feedLogger } from '../../utils/logger.js';
import {
  CoincallBsInfoMessageSchema,
  CoincallHeartbeatAckSchema,
  CoincallInstrumentsResponseSchema,
  CoincallOrderBookMessageSchema,
  CoincallPublicConfigSchema,
  CoincallTOptionMessageSchema,
  CoincallTimeSchema,
  type CoincallBsInfoMessage,
  type CoincallHeartbeatAck,
  type CoincallInstrumentsResponse,
  type CoincallOrderBookMessage,
  type CoincallPublicConfig,
  type CoincallTOptionMessage,
} from './types.js';

const log = feedLogger('coincall');

export function parseCoincallInstruments(input: unknown): CoincallInstrumentsResponse | null {
  const parsed = CoincallInstrumentsResponseSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCoincallPublicConfig(input: unknown): CoincallPublicConfig | null {
  const parsed = CoincallPublicConfigSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCoincallTime(input: unknown): number | null {
  const parsed = CoincallTimeSchema.safeParse(input);
  return parsed.success ? parsed.data.serverTime : null;
}

export function parseCoincallBsInfoMessage(input: unknown): CoincallBsInfoMessage | null {
  const parsed = CoincallBsInfoMessageSchema.safeParse(input);
  if (parsed.success) return parsed.data;

  if (parsed.error) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    log.warn({ zodError: issues }, 'Coincall bsInfo Zod validation failed');
  }
  return null;
}

export function parseCoincallTOptionMessage(input: unknown): CoincallTOptionMessage | null {
  const parsed = CoincallTOptionMessageSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCoincallOrderBookMessage(input: unknown): CoincallOrderBookMessage | null {
  const parsed = CoincallOrderBookMessageSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCoincallHeartbeatAck(input: unknown): CoincallHeartbeatAck | null {
  const parsed = CoincallHeartbeatAckSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
