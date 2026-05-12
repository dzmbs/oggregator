import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  attachMarks,
  computeShockPnl,
} from '@oggregator/core';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import {
  VolShockScenarioSchema,
  type VolShockScenario,
} from '@oggregator/protocol';

import {
  bootstrapPortfolioForAccount,
  portfolioMarkProvider,
  portfolioStore,
} from '../../portfolio-services.js';

function parseBody(input: unknown): { scenarios: VolShockScenario[] } | { error: string } {
  if (typeof input !== 'object' || input == null) return { error: 'body must be an object' };
  const scenarios = (input as { scenarios?: unknown }).scenarios;
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    return { error: 'scenarios must be a non-empty array' };
  }
  const parsed: VolShockScenario[] = [];
  for (const raw of scenarios) {
    const res = VolShockScenarioSchema.safeParse(raw);
    if (!res.success) return { error: `invalid scenario: ${res.error.message}` };
    parsed.push(res.data);
  }
  return { scenarios: parsed };
}

function getAccountId(req: FastifyRequest): string {
  return req.user?.accountId ?? DEFAULT_ACCOUNT_ID;
}

export async function portfolioScenariosRoute(app: FastifyInstance) {
  app.post('/portfolio/scenarios', async (req, reply) => {
    const parsed = parseBody(req.body);
    if ('error' in parsed) {
      return reply.status(400).send({ error: 'invalid_body', message: parsed.error });
    }
    const accountId = getAccountId(req);
    await bootstrapPortfolioForAccount(accountId);
    const positions = portfolioStore.list(accountId);
    const legsWithMarks = attachMarks(positions, portfolioMarkProvider);
    const nowMs = Date.now();
    const results = parsed.scenarios.map((scenario) =>
      computeShockPnl(scenario, legsWithMarks, nowMs),
    );
    return { results };
  });
}
