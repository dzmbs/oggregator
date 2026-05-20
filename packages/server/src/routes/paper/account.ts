import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  InitPaperAccountRequestSchema,
  type PaperAccountDto,
} from '@oggregator/protocol';
import {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_ACCOUNT_LABEL,
  DEFAULT_INITIAL_CASH_USD,
} from '@oggregator/trading';
import {
  getAccount,
  paperTradingStore,
  resetAccount,
} from '../../trading-services.js';

function persistenceUnavailable() {
  return { error: 'persistence_unavailable', message: 'DATABASE_URL not set' };
}

// Every authenticated user has their own `acct_<uuid>` row (see createUser in
// user-service.ts). Anonymous requests fall back to the shared default account.
function accountScope(req: FastifyRequest): { id: string; label: string } {
  if (req.user) {
    return { id: req.user.accountId, label: `${req.user.label}'s Account` };
  }
  return { id: DEFAULT_ACCOUNT_ID, label: DEFAULT_ACCOUNT_LABEL };
}

export async function paperAccountRoute(app: FastifyInstance) {
  app.get('/paper/account', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const { id, label } = accountScope(req);
    const account = await getAccount(id);
    return toDto(account, id, label);
  });

  app.post('/paper/account/init', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const parsed = InitPaperAccountRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const { id, label } = accountScope(req);
    const account = await resetAccount(id, label, parsed.data.initialCashUsd);
    return toDto(account, id, label);
  });
}

function toDto(
  account: Awaited<ReturnType<typeof getAccount>>,
  fallbackId: string,
  fallbackLabel: string,
): PaperAccountDto {
  if (!account) {
    return {
      id: fallbackId,
      label: fallbackLabel,
      initialCashUsd: DEFAULT_INITIAL_CASH_USD,
      createdAt: null,
      isInitialized: false,
    };
  }
  return {
    id: account.id,
    label: account.label,
    initialCashUsd: account.initialCashUsd,
    createdAt: account.createdAt.toISOString(),
    isInitialized: true,
  };
}
