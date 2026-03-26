import { Pool } from 'pg';

import type {
  RecentTradeQuery,
  TradeFilterQuery,
  TradeHistoryQuery,
  TradeHistorySummary,
  TradeStore,
  TradeVenueSummary,
} from './trade-store.js';
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
    const built = buildWhere(query);
    built.values.push(query.limit);

    const result = await this.pool.query<StoredRow>(
      `${buildSelectSql(built)}
      ORDER BY trade_ts DESC, trade_uid DESC
      LIMIT $${built.values.length}`,
      built.values,
    );

    return result.rows.map(mapRow);
  }

  async loadHistory(query: TradeHistoryQuery): Promise<PersistedTradeRecord[]> {
    const built = buildWhere(query);

    if (query.beforeTs) {
      built.values.push(query.beforeTs);
      const tsParam = `$${built.values.length}`;

      if (query.beforeUid) {
        built.values.push(query.beforeUid);
        const uidParam = `$${built.values.length}`;
        built.clauses.push(`(trade_ts, trade_uid) < (${tsParam}, ${uidParam})`);
      } else {
        built.clauses.push(`trade_ts < ${tsParam}`);
      }
    }

    built.values.push(query.limit);

    const result = await this.pool.query<StoredRow>(
      `${buildSelectSql(built)}
      ORDER BY trade_ts DESC, trade_uid DESC
      LIMIT $${built.values.length}`,
      built.values,
    );

    return result.rows.map(mapRow);
  }

  async summarizeHistory(query: TradeFilterQuery & { mode: PersistedTradeRecord['mode'] }): Promise<TradeHistorySummary> {
    const built = buildWhere(query);

    const summaryResult = await this.pool.query<SummaryRow>(
      `SELECT
        COUNT(*)::bigint AS count,
        COALESCE(SUM(premium_usd), 0)::text AS premium_usd,
        COALESCE(SUM(notional_usd), 0)::text AS notional_usd,
        MIN(trade_ts) AS oldest_ts,
        MAX(trade_ts) AS newest_ts
      FROM flow_trades
      ${buildWhereSql(built)}`,
      built.values,
    );

    const venuesResult = await this.pool.query<VenueSummaryRow>(
      `SELECT
        venue,
        COUNT(*)::bigint AS count,
        COALESCE(SUM(premium_usd), 0)::text AS premium_usd,
        COALESCE(SUM(notional_usd), 0)::text AS notional_usd
      FROM flow_trades
      ${buildWhereSql(built)}
      GROUP BY venue
      ORDER BY COUNT(*) DESC, venue ASC`,
      built.values,
    );

    const row = summaryResult.rows[0];

    return {
      count: Number(row?.count ?? 0),
      premiumUsd: toNumber(row?.premium_usd) ?? 0,
      notionalUsd: toNumber(row?.notional_usd) ?? 0,
      oldestTs: row?.oldest_ts ?? null,
      newestTs: row?.newest_ts ?? null,
      venues: venuesResult.rows.map(mapVenueSummaryRow),
    };
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}

interface BuiltWhere {
  clauses: string[];
  values: unknown[];
}

function buildWhere(query: TradeFilterQuery): BuiltWhere {
  const built: BuiltWhere = { clauses: [], values: [] };

  if (query.mode) {
    built.values.push(query.mode);
    built.clauses.push(`mode = $${built.values.length}`);
  }

  if (query.underlying) {
    built.values.push(query.underlying.toUpperCase());
    built.clauses.push(`underlying = $${built.values.length}`);
  }

  if (query.venues && query.venues.length > 0) {
    built.values.push(query.venues);
    built.clauses.push(`venue = ANY($${built.values.length}::text[])`);
  }

  if (query.startTs) {
    built.values.push(query.startTs);
    built.clauses.push(`trade_ts >= $${built.values.length}`);
  }

  if (query.endTs) {
    built.values.push(query.endTs);
    built.clauses.push(`trade_ts < $${built.values.length}`);
  }

  return built;
}

function buildWhereSql(where: BuiltWhere): string {
  return where.clauses.length > 0 ? `WHERE ${where.clauses.join(' AND ')}` : '';
}

function buildSelectSql(where: BuiltWhere): string {
  return `SELECT
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
  ${buildWhereSql(where)}`;
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

interface SummaryRow {
  count: string;
  premium_usd: string;
  notional_usd: string;
  oldest_ts: Date | null;
  newest_ts: Date | null;
}

interface VenueSummaryRow {
  venue: string;
  count: string;
  premium_usd: string;
  notional_usd: string;
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

function mapVenueSummaryRow(row: VenueSummaryRow): TradeVenueSummary {
  return {
    venue: row.venue,
    count: Number(row.count),
    premiumUsd: toNumber(row.premium_usd) ?? 0,
    notionalUsd: toNumber(row.notional_usd) ?? 0,
  };
}

function toNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
