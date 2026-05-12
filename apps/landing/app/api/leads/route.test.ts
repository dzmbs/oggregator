import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach } from 'vitest';

import { POST } from './route';

let leadFilePath = '';

beforeEach(() => {
  leadFilePath = path.join(tmpdir(), `landing-leads-${randomUUID()}.jsonl`);
  process.env.LANDING_LEADS_FILE = leadFilePath;
});

afterEach(async () => {
  delete process.env.LANDING_LEADS_FILE;
  await rm(leadFilePath, { force: true });
});

describe('POST /api/leads', () => {
  it('accepts a valid email payload', async () => {
    const request = new Request('http://localhost/api/leads', {
      method: 'POST',
      body: JSON.stringify({
        email: 'desk@example.com',
        source: 'landing-hero',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.ok).toBe(true);

    const stored = await readFile(leadFilePath, 'utf8');
    const [line = ''] = stored.trim().split('\n');
    const record = JSON.parse(line) as {
      createdAt: string;
      email: string;
      source: string;
    };

    expect(record.email).toBe('desk@example.com');
    expect(record.source).toBe('landing-hero');
    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('rejects an invalid email payload', async () => {
    const request = new Request('http://localhost/api/leads', {
      method: 'POST',
      body: JSON.stringify({
        email: 'bad-email',
        source: 'landing-hero',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
  });
});
