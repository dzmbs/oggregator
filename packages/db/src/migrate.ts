import { setDefaultResultOrder } from 'node:dns';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// WSL2 + Neon: AAAA records aren't routable here. pg calls dns.lookup() with no
// family option, so we change the process-wide default before pg loads.
setDefaultResultOrder('ipv4first');

const { Pool } = await import('pg');

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '../migrations');
const databaseUrl = process.env['DATABASE_URL'];

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run migrations');
}

const pool = new Pool({ connectionString: databaseUrl });
const MIGRATION_LOCK_ID = 4_259_103;

try {
  await pool.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = await pool.query<{ version: string }>('SELECT version FROM schema_migrations');
  const appliedVersions = new Set(applied.rows.map((row) => row.version));
  const entries = (await readdir(migrationsDir)).filter((entry) => entry.endsWith('.sql')).sort();

  for (const entry of entries) {
    if (appliedVersions.has(entry)) continue;

    const sql = await readFile(join(migrationsDir, entry), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [entry]);
      await pool.query('COMMIT');
      console.log(`applied ${entry}`);
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  try {
    await pool.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
  } finally {
    await pool.end();
  }
}
