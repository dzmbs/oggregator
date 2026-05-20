import type { FastifyInstance } from 'fastify';
import { createUser } from '../../user-service.js';

const registerRateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = registerRateLimit.get(ip);
  if (!record || now > record.resetAt) {
    registerRateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (record.count >= RATE_LIMIT_MAX) {
    return true;
  }
  record.count++;
  return false;
}

export async function paperAuthRoute(app: FastifyInstance) {
  app.post('/paper/auth/register', async (req, reply) => {
    const clientIp = req.ip || 'unknown';
    if (isRateLimited(clientIp)) {
      return reply.status(429).send({ error: 'rate_limited', message: 'Too many requests, try again later' });
    }

    const { label } = req.body as { label?: string };
    if (!label || typeof label !== 'string' || label.length < 1 || label.length > 50) {
      return reply.status(400).send({ error: 'invalid_label', message: 'Label must be 1-50 characters' });
    }
    try {
      const { user, account } = await createUser(label.trim());
      return reply.send({
        userId: user.id,
        apiKey: user.apiKey,
        accountId: user.accountId,
        label: user.label,
        account: {
          id: account.id,
          label: account.label,
          initialCashUsd: account.initialCashUsd,
          createdAt: account.createdAt.toISOString(),
        },
      });
    } catch (error) {
      console.error('Failed to create user:', error);
      return reply.status(500).send({ error: 'internal_error', message: 'Failed to create user' });
    }
  });
}