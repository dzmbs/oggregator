import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import { pnlService } from '../../trading-services.js';
import { pnlToDto } from './mappers.js';

function getAccountId(req: FastifyRequest): string {
  return req.user?.accountId ?? DEFAULT_ACCOUNT_ID;
}

export async function paperPnlRoute(app: FastifyInstance) {
  app.get('/paper/pnl', async (req) => {
    const accountId = getAccountId(req);
    const snap = await pnlService.snapshot(accountId);
    return pnlToDto(snap);
  });
}
