import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import {
  positionRepository,
  quoteProvider,
} from '../../trading-services.js';
import { positionToDto } from './mappers.js';

function getAccountId(req: FastifyRequest): string {
  return req.user?.accountId ?? DEFAULT_ACCOUNT_ID;
}

export async function paperPositionsRoute(app: FastifyInstance) {
  app.get('/paper/positions', async (req) => {
    const accountId = getAccountId(req);
    const positions = await positionRepository.listPositions(accountId);
    const open = positions.filter((p) => p.netQuantity !== 0);
    const marks = await Promise.all(
      open.map(async (p) =>
        quoteProvider.getMark({
          underlying: p.key.underlying,
          expiry: p.key.expiry,
          strike: p.key.strike,
          optionRight: p.key.optionRight,
        }),
      ),
    );
    return {
      positions: open.map((pos, idx) => positionToDto(pos, marks[idx] ?? null)),
    };
  });
}
