import { Pool } from 'pg';

import type { RecentTradeQuery, TradeStore } from './trade-store.js';
import type { PersistedTradeRecord } from './types.js';

const INSERT_BATCH_SIZE = 100;

export class PostgresTradeStore implements TradeStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresTradeStore {
    return new PostgresTradeStore(new Pool({ connectionString }));
  }

  async writeMany(records: PersistedTradeRecord[]): Promise<void> {
    if (records.length === 0) return;

    for (let index = 0; index < records.length; index += INSERT_BATCH_SIZE) {
      const batch = records.slice(index, index + INSERT_BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((record, batchIndex) => {
        const offset = batchIndex * 22;
        values.push(
          record.tradeUid,
          record.mode,
          record.venue,
          record.underlying,
          record.instrumentName,
          record.tradeTs,
          record.ingestedAt,
          record.direction,
          record.contracts,
          record.price,
          record.premiumUsd,
          record.notionalUsd,
          record.referencePriceUsd,
          record.expiry,
          record.strike,
          record.optionType,
          record.iv,
          record.markPrice,
          record.isBlock,
          record.strategyLabel,
          JSON.stringify(record.legs),
          JSON.stringify(record.raw),
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}, $${offset + 19}, $${offset + 20}, $${offset + 21}::jsonb, $${offset + 22}::jsonb)`;
      });

      await this.pool.query(
        `INSERT INTO flow_trades (
          trade_uid,
          mode,
          venue,
          underlying,
          instrument_name,
          trade_ts,
          ingested_at,
          direction,
          contracts,
          price,
          premium_usd,
          notional_usd,
          reference_price_usd,
          expiry,
          strike,
          option_type,
          iv,
          mark_price,
          is_block,
          strategy_label,
          legs,
          raw
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (trade_uid) DO NOTHING`,
        values,
      );
    }
  }

  async loadRecent(query: RecentTradeQuery): Promise<PersistedTradeRecord[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (query.mode) {
      values.push(query.mode);
      clauses.push(`mode = $${values.length}`);
    }

    if (query.underlying) {
      values.push(query.underlying.toUpperCase());
      clauses.push(`underlying = $${values.length}`);
    }

    if (query.venue) {
      values.push(query.venue);
      clauses.push(`venue = $${values.length}`);
    }

    values.push(query.limit);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const result = await this.pool.query<StoredRow>(
      `SELECT
        trade_uid,
        mode,
        venue,
        underlying,
        instrument_name,
        trade_ts,
        ingested_at,
        direction,
        contracts,
        price,
        premium_usd,
        notional_usd,
        reference_price_usd,
        expiry,
        strike,
        option_type,
        iv,
        mark_price,
        is_block,
        strategy_label,
        legs,
        raw
      FROM flow_trades
      ${where}
      ORDER BY trade_ts DESC
      LIMIT $${values.length}`,
      values,
    );

    return result.rows.map(mapRow);
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}

interface StoredRow {
  trade_uid: string;
  mode: 'live' | 'institutional';
  venue: string;
  underlying: string;
  instrument_name: string;
  trade_ts: Date;
  ingested_at: Date;
  direction: 'buy' | 'sell';
  contracts: string;
  price: string | null;
  premium_usd: string | null;
  notional_usd: string | null;
  reference_price_usd: string | null;
  expiry: string | null;
  strike: string | null;
  option_type: 'call' | 'put' | null;
  iv: string | null;
  mark_price: string | null;
  is_block: boolean;
  strategy_label: string | null;
  legs: PersistedTradeRecord['legs'];
  raw: Record<string, unknown>;
}

function mapRow(row: StoredRow): PersistedTradeRecord {
  return {
    tradeUid: row.trade_uid,
    mode: row.mode,
    venue: row.venue,
    underlying: row.underlying,
    instrumentName: row.instrument_name,
    tradeTs: row.trade_ts,
    ingestedAt: row.ingested_at,
    direction: row.direction,
    contracts: Number(row.contracts),
    price: toNumber(row.price),
    premiumUsd: toNumber(row.premium_usd),
    notionalUsd: toNumber(row.notional_usd),
    referencePriceUsd: toNumber(row.reference_price_usd),
    expiry: row.expiry,
    strike: toNumber(row.strike),
    optionType: row.option_type,
    iv: toNumber(row.iv),
    markPrice: toNumber(row.mark_price),
    isBlock: row.is_block,
    strategyLabel: row.strategy_label,
    legs: row.legs ?? null,
    raw: row.raw,
  };
}

function toNumber(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
