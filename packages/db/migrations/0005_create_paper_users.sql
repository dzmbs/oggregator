CREATE TABLE IF NOT EXISTS paper_users (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES paper_accounts (id),
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paper_users_api_key_idx ON paper_users (api_key);
CREATE INDEX IF NOT EXISTS paper_users_account_idx ON paper_users (account_id);
