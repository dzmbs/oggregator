import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import {
  buildIvSurfaceGrid,
  computeCmmIvSurface,
  computeTermStructure,
  getAllAdapters,
  realizedVol,
  type CmmIvSurfaceRow,
  type IvSurfaceRow,
  type IvSurfaceFineRow,
  type TermStructure,
  type VenueId,
  VENUE_IDS,
  FINE_DELTA_GRID,
  ULTRA_FINE_DELTA_GRID,
  DENSE_CMM_TENORS,
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

    const entries = await buildIvSurfaceGrid({
      underlying,
      venues: requestedVenues,
      includeVenueSurfaces: true,
    });

    const surface: IvSurfaceRow[] = new Array(entries.length);
    const surfaceFine: IvSurfaceFineRow[] = new Array(entries.length);
    const surfaceFineSmoothed: IvSurfaceFineRow[] = new Array(entries.length);
    const venueAtm: Record<string, Array<{ expiry: string; dte: number; atm: number | null }>> = {};
    const venueSurfaceFine: Partial<Record<VenueId, IvSurfaceFineRow[]>> = {};
    const venueSurfaceFineSmoothed: Partial<Record<VenueId, IvSurfaceFineRow[]>> = {};
    for (const venueId of requestedVenues) {
      venueAtm[venueId] = [];
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      surface[i] = entry.surfaceRow;
      surfaceFine[i] = entry.surfaceFineRow;
      surfaceFineSmoothed[i] = entry.surfaceFineSmoothedRow;
      for (const venueId of requestedVenues) {
        const callIv = entry.atmStrike?.call.venues[venueId]?.markIv ?? null;
        const putIv = entry.atmStrike?.put.venues[venueId]?.markIv ?? null;
        const iv =
          callIv != null && putIv != null ? (callIv + putIv) / 2 : (callIv ?? putIv);
        venueAtm[venueId]!.push({ expiry: entry.expiry, dte: entry.dte, atm: iv });

        const fine = entry.venueSurfaceFineRow[venueId];
        const smoothed = entry.venueSurfaceFineSmoothedRow[venueId];
        if (fine) (venueSurfaceFine[venueId] ??= []).push(fine);
        if (smoothed) (venueSurfaceFineSmoothed[venueId] ??= []).push(smoothed);
      }
    }

    const termStructure: TermStructure = computeTermStructure(surface);
    const surfaceFineCmm: CmmIvSurfaceRow[] = computeCmmIvSurface(
      surfaceFineSmoothed,
      DENSE_CMM_TENORS,
    );

    const venueSurfaceFineCmm: Partial<Record<VenueId, CmmIvSurfaceRow[]>> = {};
    for (const venueId of requestedVenues) {
      const rows = venueSurfaceFineSmoothed[venueId];
      if (!rows || rows.length === 0) continue;
      const cmm = computeCmmIvSurface(rows, DENSE_CMM_TENORS);
      if (cmm.length > 0) venueSurfaceFineCmm[venueId] = cmm;
    }
    const { atmIv30d, rv30d, vrp30d } = await computeVrpContext(underlying, req.log);

    reply.header('Cache-Control', 'public, max-age=0, s-maxage=1, stale-while-revalidate=2');

    return {
      underlying,
      surface,
      surfaceFine,
      surfaceFineSmoothed,
      surfaceFineCmm,
      surfaceFineDeltas: FINE_DELTA_GRID,
      surfaceFineDeltasDense: ULTRA_FINE_DELTA_GRID,
      termStructure,
      venueAtm,
      venueSurfaceFine,
      venueSurfaceFineSmoothed,
      venueSurfaceFineCmm,
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
