import type { FastifyRequest, FastifyReply } from 'fastify';
import type { PaperUserRow, PaperAccountRow } from '@oggregator/db';
import { paperTradingStore } from './trading-services.js';

const DEFAULT_INITIAL_CASH_USD = 100_000;

export interface AuthenticatedUser {
  id: string;
  accountId: string;
  label: string;
}

export async function createUser(label: string): Promise<{ user: PaperUserRow; account: PaperAccountRow }> {
  const userId = `usr_${crypto.randomUUID()}`;
  const accountId = `acct_${crypto.randomUUID()}`;
  const apiKey = generateApiKey();

  const account: PaperAccountRow = {
    id: accountId,
    label: `${label}'s Account`,
    initialCashUsd: DEFAULT_INITIAL_CASH_USD,
    createdAt: new Date(),
  };
  await paperTradingStore.ensureAccount(account);

  const user: PaperUserRow = {
    id: userId,
    apiKey,
    accountId,
    label,
    createdAt: new Date(),
  };
  await paperTradingStore.createUser(user);

  return { user, account };
}

export async function getUserByApiKey(apiKey: string): Promise<PaperUserRow | null> {
  return paperTradingStore.getUserByApiKey(apiKey);
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function authenticateUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthenticatedUser | null> {
  const apiKey = request.headers['x-api-key'] as string | undefined;

  if (!apiKey) {
    return null;
  }

  const user = await paperTradingStore.getUserByApiKey(apiKey);
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    accountId: user.accountId,
    label: user.label,
  };
}

export function requireUser() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.url.startsWith('/api/paper/auth/')) {
      return;
    }
    if (!paperTradingStore.enabled) {
      return;
    }
    const user = await authenticateUser(request, reply);
    if (!user) {
      reply.status(401).send({ error: 'unauthorized', message: 'Invalid or missing X-API-Key' });
      return;
    }
    request.user = user;
  };
}

export function getRequestAccountId(req: FastifyRequest, fallback: string): string {
  if (paperTradingStore.enabled) {
    if (!req.user) {
      throw new Error('getRequestAccountId called without authenticated user');
    }
    return req.user.accountId;
  }
  return req.user?.accountId ?? fallback;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}
