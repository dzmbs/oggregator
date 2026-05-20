import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import { VenueIdSchema, type VenueId } from '@oggregator/protocol';

import { derivePositionStore } from '../../derive-position-store.js';
import { thalexPositionStore } from '../../thalex-position-store.js';
import { getOrCreatePortfolioRuntime } from '../../portfolio-services.js';
import { getRequestAccountId } from '../../user-service.js';

const DeriveCredsSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'walletAddress must be a 0x-prefixed Ethereum address'),
  signerPrivateKey: z.string().regex(/^(0x)?[a-fA-F0-9]{64}$/, 'signerPrivateKey must be 32-byte hex'),
  subaccountId: z.coerce.number().int().positive(),
  env: z.enum(['prod', 'test']).optional(),
});

const ThalexCredsSchema = z.object({
  kid: z.string().min(1),
  privateKeyPem: z.string().min(1),
  account: z.string().optional(),
  env: z.enum(['prod', 'test']).optional(),
});

function getAccountId(req: FastifyRequest): string {
  return getRequestAccountId(req, DEFAULT_ACCOUNT_ID);
}

export async function portfolioVenueCredentialsRoute(app: FastifyInstance) {
  app.post<{
    Params: { venue: string };
    Body: unknown;
  }>('/portfolio/venue-credentials/:venue', async (req, reply) => {
    const venueParsed = VenueIdSchema.safeParse(req.params.venue);
    if (!venueParsed.success) {
      return reply.status(400).send({ error: 'invalid_venue', issues: venueParsed.error.issues });
    }
    const venue: VenueId = venueParsed.data;
    const accountId = getAccountId(req);

    if (venue === 'derive') {
      const credsParsed = DeriveCredsSchema.safeParse(req.body);
      if (!credsParsed.success) {
        req.log.warn({ venue, issues: credsParsed.error.issues }, 'portfolio invalid_creds');
        return reply.status(400).send({ error: 'invalid_creds', issues: credsParsed.error.issues });
      }
      try {
        const creds = credsParsed.data;
        await derivePositionStore.connect({
          accountId,
          walletAddress: creds.walletAddress,
          signerPrivateKey: creds.signerPrivateKey,
          subaccountId: creds.subaccountId,
          ...(creds.env != null && { env: creds.env }),
        });
        getOrCreatePortfolioRuntime(accountId, 'derive');
        return { venue, connected: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'connect failed';
        return reply.status(502).send({ error: 'connect_failed', message });
      }
    }

    if (venue === 'thalex') {
      const credsParsed = ThalexCredsSchema.safeParse(req.body);
      if (!credsParsed.success) {
        req.log.warn({ venue, issues: credsParsed.error.issues }, 'portfolio invalid_creds');
        return reply.status(400).send({ error: 'invalid_creds', issues: credsParsed.error.issues });
      }
      try {
        const creds = credsParsed.data;
        await thalexPositionStore.connect({
          accountId,
          kid: creds.kid,
          privateKeyPem: creds.privateKeyPem,
          ...(creds.account != null && { account: creds.account }),
          ...(creds.env != null && { env: creds.env }),
        });
        getOrCreatePortfolioRuntime(accountId, 'thalex');
        return { venue, connected: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'connect failed';
        req.log.warn({ err: String(err), venue: 'thalex' }, 'thalex connect_failed');
        return reply.status(502).send({ error: 'connect_failed', message });
      }
    }

    return reply
      .status(501)
      .send({
        error: 'not_implemented',
        message: `private adapter for ${venue} is not wired yet (see PRIVATE_ADAPTER_SPECS.${venue}.todos)`,
      });
  });

  app.delete<{ Params: { venue: string } }>(
    '/portfolio/venue-credentials/:venue',
    async (req, reply) => {
      const venueParsed = VenueIdSchema.safeParse(req.params.venue);
      if (!venueParsed.success) {
        return reply.status(400).send({ error: 'invalid_venue' });
      }
      const accountId = getAccountId(req);
      if (venueParsed.data === 'derive') {
        await derivePositionStore.disconnect(accountId);
      } else if (venueParsed.data === 'thalex') {
        await thalexPositionStore.disconnect(accountId);
      }
      return { venue: venueParsed.data, connected: false };
    },
  );

  app.get<{ Params: { venue: string } }>(
    '/portfolio/venue-credentials/:venue/status',
    async (req, reply) => {
      const venueParsed = VenueIdSchema.safeParse(req.params.venue);
      if (!venueParsed.success) {
        return reply.status(400).send({ error: 'invalid_venue' });
      }
      const accountId = getAccountId(req);
      if (venueParsed.data === 'derive') {
        return { venue: 'derive', connected: derivePositionStore.isConnected(accountId) };
      }
      if (venueParsed.data === 'thalex') {
        return { venue: 'thalex', connected: thalexPositionStore.isConnected(accountId) };
      }
      return { venue: venueParsed.data, connected: false };
    },
  );
}
