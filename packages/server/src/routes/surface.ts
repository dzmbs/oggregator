import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import {
  buildIvSurfaceGrid,
  computeTermStructure,
  getAllAdapters,
  realizedVol,
  type IvSurfaceRow,
  type IvSurfaceFineRow,
  type TermStructure,
  type VenueId,
  VENUE_IDS,
  FINE_DELTA_GRID,
} from '@oggregator/core';
import {
  isIvHistoryReady,
  isSpotCandlesReady,
  ivHistoryService,
  spotCandleService,
} from '../services.js';

const SECONDS_PER_DAY = 86_400;
const DAYS_IN_YEAR = 365;

export async function surfaceRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { underlying: string; venues?: string };
  }>('/surface', async (req, reply) => {
    const { underlying, venues: venuesParam } = req.query;

    if (!underlying) {
      return reply.status(400).send({ error: 'underlying query param required' });
    }

    const requestedVenues: VenueId[] = venuesParam
      ? (venuesParam.split(',').filter((v) => VENUE_IDS.includes(v as VenueId)) as VenueId[])
      : getAllAdapters().map((a) => a.venue);

    const entries = await buildIvSurfaceGrid({ underlying, venues: requestedVenues });

    const surface: IvSurfaceRow[] = new Array(entries.length);
    const surfaceFine: IvSurfaceFineRow[] = new Array(entries.length);
    const venueAtm: Record<string, Array<{ expiry: string; dte: number; atm: number | null }>> = {};
    for (const venueId of requestedVenues) {
      venueAtm[venueId] = [];
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      surface[i] = entry.surfaceRow;
      surfaceFine[i] = entry.surfaceFineRow;
      for (const venueId of requestedVenues) {
        const callIv = entry.atmStrike?.call.venues[venueId]?.markIv ?? null;
        const putIv = entry.atmStrike?.put.venues[venueId]?.markIv ?? null;
        const iv =
          callIv != null && putIv != null ? (callIv + putIv) / 2 : (callIv ?? putIv);
        venueAtm[venueId]!.push({ expiry: entry.expiry, dte: entry.dte, atm: iv });
      }
    }

    const termStructure: TermStructure = computeTermStructure(surface);
    const { atmIv30d, rv30d, vrp30d } = await computeVrpContext(underlying, req.log);

    reply.header('Cache-Control', 'public, max-age=0, s-maxage=1, stale-while-revalidate=2');

    return {
      underlying,
      surface,
      surfaceFine,
      surfaceFineDeltas: FINE_DELTA_GRID,
      termStructure,
      venueAtm,
      atmIv30d,
      rv30d,
      vrp30d,
    };
  });
}

interface VrpContext {
  atmIv30d: number | null;
  rv30d: number | null;
  vrp30d: number | null;
}

async function computeVrpContext(
  underlying: string,
  log: FastifyBaseLogger,
): Promise<VrpContext> {
  const atmIv30d = readAtm30dIv(underlying, log);
  const rv30d = await readRv30d(underlying, log);
  const vrp30d = atmIv30d != null && rv30d != null ? atmIv30d - rv30d : null;
  return { atmIv30d, rv30d, vrp30d };
}

function readAtm30dIv(underlying: string, log: FastifyBaseLogger): number | null {
  if (!isIvHistoryReady()) return null;
  try {
    const result = ivHistoryService.query(underlying, 30);
    return result.tenors['30d'].current.atmIv;
  } catch (err: unknown) {
    log.warn({ err, underlying, fn: 'readAtm30dIv' }, 'VRP context: ATM IV30d lookup failed');
    return null;
  }
}

async function readRv30d(underlying: string, log: FastifyBaseLogger): Promise<number | null> {
  if (!isSpotCandlesReady()) return null;
  if (underlying !== 'BTC' && underlying !== 'ETH') return null;
  try {
    const candles = await spotCandleService.getCandles(underlying, SECONDS_PER_DAY, 31);
    const closes = candles.map((c) => c.close);
    return realizedVol(closes, DAYS_IN_YEAR);
  } catch (err: unknown) {
    log.warn({ err, underlying, fn: 'readRv30d' }, 'VRP context: RV30d lookup failed');
    return null;
  }
}
