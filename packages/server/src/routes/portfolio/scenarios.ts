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

function parseScenarios(body: unknown): { scenarios: VolShockScenario[] } | { error: string; issues: unknown[] } {
  if (typeof body !== 'object' || body == null) {
    return { error: 'invalid_body', issues: [{ message: 'body must be an object' }] };
  }
  const scenarios = (body as { scenarios?: unknown }).scenarios;
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    return { error: 'invalid_body', issues: [{ message: 'scenarios must be a non-empty array' }] };
  }
  const parsed: VolShockScenario[] = [];
  for (const raw of scenarios) {
    const res = VolShockScenarioSchema.safeParse(raw);
    if (!res.success) return { error: 'invalid_body', issues: res.error.issues };
    parsed.push(res.data);
  }
  return { scenarios: parsed };
}

function getAccountId(req: FastifyRequest): string {
  return req.user?.accountId ?? DEFAULT_ACCOUNT_ID;
}

export async function portfolioScenariosRoute(app: FastifyInstance) {
  app.post('/portfolio/scenarios', async (req, reply) => {
    const parsed = parseScenarios(req.body);
    if ('error' in parsed) {
      return reply.status(400).send({ error: parsed.error, issues: parsed.issues });
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
