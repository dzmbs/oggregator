import { PostgresTradeStore, type PersistedTradeLeg, type PersistedTradeRecord } from './index.js';

const MONTH_CODES = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

const databaseUrl = process.env['DATABASE_URL'];

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to seed sample trades');
}

const store = PostgresTradeStore.fromConnectionString(databaseUrl);

try {
  const records = buildSampleRecords();
  await store.writeMany(records);
  console.log(`seeded ${records.length} sample trades`);
} finally {
  await store.dispose();
}

function buildSampleRecords(): PersistedTradeRecord[] {
  const now = Date.now();
  const records: PersistedTradeRecord[] = [];

  records.push(...buildLiveRecords('BTC', now, 140));
  records.push(...buildBlockRecords('BTC', now, 32));
  records.push(...buildLiveRecords('ETH', now - 60_000, 60));
  records.push(...buildBlockRecords('ETH', now - 60_000, 16));

  return records;
}

function buildLiveRecords(
  underlying: 'BTC' | 'ETH',
  now: number,
  count: number,
): PersistedTradeRecord[] {
  const venues = ['deribit', 'bybit', 'okx', 'binance', 'derive'] as const;
  const expiries =
    underlying === 'BTC'
      ? ['2026-03-27', '2026-04-03', '2026-04-24']
      : ['2026-03-27', '2026-04-03'];
  const baseSpot = underlying === 'BTC' ? 69_800 : 3_520;

  return Array.from({ length: count }, (_, index) => {
    const venue = pickVenue(venues, index);
    const expiry = expiries[index % expiries.length] ?? expiries[0]!;
    const optionType = index % 2 === 0 ? 'call' : 'put';
    const strikeStep = underlying === 'BTC' ? 1_000 : 50;
    const strikeBase = underlying === 'BTC' ? 64_000 : 3_000;
    const strike = strikeBase + (index % 12) * strikeStep;
    const tradeId = `seed-live-${underlying.toLowerCase()}-${String(index + 1).padStart(4, '0')}`;
    const tradeTs = new Date(now - index * 12_000);
    const direction = index % 3 === 0 ? 'sell' : 'buy';
    const contracts = Number((0.1 + (index % 5) * 0.25).toFixed(4));
    const referencePriceUsd = baseSpot + (index % 9) * (underlying === 'BTC' ? 120 : 8);
    const price = Number(
      (optionType === 'call' ? 480 + (index % 7) * 38 : 410 + (index % 6) * 29).toFixed(2),
    );
    const premiumUsd = Number((price * contracts).toFixed(2));
    const notionalUsd = Number((contracts * referencePriceUsd).toFixed(2));
    const instrumentName = formatInstrument(underlying, expiry, strike, optionType);

    return {
      tradeUid: `${venue}:${tradeId}`,
      mode: 'live',
      venue,
      underlying,
      instrumentName,
      tradeTs,
      ingestedAt: new Date(tradeTs.getTime() + 250),
      direction,
      contracts,
      price,
      premiumUsd,
      notionalUsd,
      referencePriceUsd,
      expiry,
      strike,
      optionType,
      iv: Number((0.42 + (index % 8) * 0.015).toFixed(4)),
      markPrice: Number((price * 0.98).toFixed(2)),
      isBlock: index % 17 === 0,
      strategyLabel: null,
      legs: null,
      raw: {
        seeded: true,
        tradeId,
        timestamp: tradeTs.getTime(),
      },
    };
  });
}

function buildBlockRecords(
  underlying: 'BTC' | 'ETH',
  now: number,
  count: number,
): PersistedTradeRecord[] {
  const venues = ['deribit', 'bybit', 'okx', 'binance', 'derive'] as const;
  const expiries =
    underlying === 'BTC' ? ['2026-04-24', '2026-05-29'] : ['2026-04-24', '2026-05-29'];
  const baseSpot = underlying === 'BTC' ? 69_800 : 3_520;

  return Array.from({ length: count }, (_, index) => {
    const venue = pickVenue(venues, index);
    const expiry = expiries[index % expiries.length] ?? expiries[0]!;
    const lowerStrike =
      (underlying === 'BTC' ? 68_000 : 3_200) + (index % 6) * (underlying === 'BTC' ? 1_000 : 50);
    const upperStrike = lowerStrike + (underlying === 'BTC' ? 4_000 : 200);
    const optionType = index % 2 === 0 ? 'call' : 'put';
    const tradeId = `seed-block-${underlying.toLowerCase()}-${String(index + 1).padStart(4, '0')}`;
    const tradeTs = new Date(now - index * 180_000 - 30_000);
    const referencePriceUsd = baseSpot + (index % 5) * (underlying === 'BTC' ? 150 : 12);
    const totalContracts = Number((5 + (index % 4) * 2.5).toFixed(2));
    const frontPrice = Number((optionType === 'call' ? 620 : 540).toFixed(2));
    const backPrice = Number((optionType === 'call' ? 280 : 240).toFixed(2));
    const firstLeg: PersistedTradeLeg = {
      instrument: formatInstrument(underlying, expiry, lowerStrike, optionType),
      direction: 'buy',
      price: frontPrice,
      size: totalContracts,
      ratio: 1,
    };
    const secondLeg: PersistedTradeLeg = {
      instrument: formatInstrument(underlying, expiry, upperStrike, optionType),
      direction: 'sell',
      price: backPrice,
      size: totalContracts,
      ratio: 1,
    };
    const legs: PersistedTradeLeg[] = [firstLeg, secondLeg];
    const premiumUsd = Number(((frontPrice - backPrice) * totalContracts).toFixed(2));
    const notionalUsd = Number((referencePriceUsd * totalContracts * 2).toFixed(2));
    const strategyLabel = optionType === 'call' ? 'CALL_SPREAD' : 'PUT_SPREAD';

    return {
      tradeUid: `${venue}:${tradeId}`,
      mode: 'institutional',
      venue,
      underlying,
      instrumentName: firstLeg.instrument,
      tradeTs,
      ingestedAt: new Date(tradeTs.getTime() + 500),
      direction: index % 3 === 0 ? 'sell' : 'buy',
      contracts: totalContracts,
      price: null,
      premiumUsd,
      notionalUsd,
      referencePriceUsd,
      expiry,
      strike: lowerStrike,
      optionType,
      iv: null,
      markPrice: null,
      isBlock: true,
      strategyLabel,
      legs,
      raw: {
        seeded: true,
        tradeId,
        totalSize: totalContracts,
        indexPrice: referencePriceUsd,
        timestamp: tradeTs.getTime(),
      },
    };
  });
}

function formatInstrument(
  underlying: string,
  expiry: string,
  strike: number,
  optionType: 'call' | 'put',
): string {
  const [, year, month, day] = expiry.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
  if (!year || !month || !day) {
    throw new Error(`Invalid expiry: ${expiry}`);
  }

  const monthCode = MONTH_CODES[Number(month) - 1];
  if (!monthCode) {
    throw new Error(`Invalid expiry month: ${expiry}`);
  }

  return `${underlying}-${Number(day)}${monthCode}${year.slice(2)}-${strike}-${optionType === 'call' ? 'C' : 'P'}`;
}

function pickVenue(venues: readonly string[], index: number): string {
  const venue = venues[index % venues.length];
  if (!venue) {
    throw new Error(`Missing venue for index ${index}`);
  }
  return venue;
}
