# @oggregator/protocol

Shared Zod schemas and TypeScript types for the WebSocket protocol between server and web client.

## What's in here

- `VenueId` — branded union of supported venue identifiers
- `WsSubscriptionRequest` / `ClientWsMessage` — client to server message schemas
- `ServerWsMessage` / `SnapshotMeta` — server to client message schemas
- `VenueFailure` — per-venue error reporting
- `WsConnectionState` — connection lifecycle states

All schemas are Zod-validated at I/O boundaries. Types are inferred from schemas, no manual type/schema drift.

## Usage

```typescript
import { ServerWsMessageSchema, type ServerWsMessage } from "@oggregator/protocol";

const parsed = ServerWsMessageSchema.safeParse(JSON.parse(raw));
if (!parsed.success) return;
handleMessage(parsed.data);
```

## Commands

```bash
pnpm build        # tsc
pnpm typecheck    # tsc --noEmit
pnpm test:run     # vitest
```
