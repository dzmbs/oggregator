import {
  OkxInstrumentSchema,
  OkxMarkPriceSchema,
  OkxOptSummarySchema,
  OkxRestResponseSchema,
  OkxTickerSchema,
  OkxWsInstrumentsMsgSchema,
  OkxWsMarkPriceMsgSchema,
  OkxWsNoticeSchema,
  OkxWsOptSummaryMsgSchema,
  OkxWsStatusMsgSchema,
  OkxWsTickerMsgSchema,
  type OkxInstrument,
  type OkxMarkPrice,
  type OkxOptSummary,
  type OkxRestResponse,
  type OkxTicker,
  type OkxWsInstrumentsMsg,
  type OkxWsMarkPriceMsg,
  type OkxWsNotice,
  type OkxWsOptSummaryMsg,
  type OkxWsStatusMsg,
  type OkxWsTickerMsg,
} from './types.js';

export function parseOkxInstrument(input: unknown): OkxInstrument | null {
  const parsed = OkxInstrumentSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseOkxTicker(input: unknown): OkxTicker | null {
  const parsed = OkxTickerSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseOkxOptSummary(input: unknown): OkxOptSummary | null {
  const parsed = OkxOptSummarySchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseOkxMarkPrice(input: unknown): OkxMarkPrice | null {
  const parsed = OkxMarkPriceSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseOkxRestResponse(input: unknown): OkxRestResponse | null {
  const parsed = OkxRestResponseSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseOkxWsNotice(input: unknown): OkxWsNotice | null {
  const parsed = OkxWsNoticeSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseOkxWsOptSummaryMsg(input: unknown): OkxWsOptSummaryMsg | null {
  const parsed = OkxWsOptSummaryMsgSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseOkxWsTickerMsg(input: unknown): OkxWsTickerMsg | null {
  const parsed = OkxWsTickerMsgSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseOkxWsMarkPriceMsg(input: unknown): OkxWsMarkPriceMsg | null {
  const parsed = OkxWsMarkPriceMsgSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseOkxWsInstrumentsMsg(input: unknown): OkxWsInstrumentsMsg | null {
  const parsed = OkxWsInstrumentsMsgSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseOkxWsStatusMsg(input: unknown): OkxWsStatusMsg | null {
  const parsed = OkxWsStatusMsgSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
