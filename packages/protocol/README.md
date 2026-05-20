# @oggregator/protocol

Shared Zod schemas and TypeScript types for server/web contracts: chain streaming, paper trading, portfolio analytics, and private venue credentials.

## What's in here

- `ws.ts` — chain websocket subscriptions, snapshots, deltas, and venue failure metadata
- `paper.ts` — paper trading request/response and websocket payloads
- `portfolio.ts` — positions, portfolio metrics, pnl curve, scenario analysis, and portfolio websocket payloads
- `venue-credentials.ts` — private venue credential specs and connection status payloads

All schemas are Zod-validated at I/O boundaries. Types are inferred from schemas so server and web do not drift on payload shape.

## Usage

```typescript
import { PortfolioWsServerMessageSchema, type PortfolioWsServerMessage } from '@oggregator/protocol';

const parsed = PortfolioWsServerMessageSchema.safeParse(JSON.parse(raw));
if (!parsed.success) return;
handleMessage(parsed.data);
```

## Commands

```bash
pnpm build        # tsc
pnpm typecheck    # tsc --noEmit
pnpm test:run     # vitest
```
