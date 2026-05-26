CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  email         TEXT NOT NULL,
  display_name  TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE auth_tokens (
  account_id           TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  refresh_token_enc    BLOB NOT NULL,
  homeAccountId        TEXT,
  scope                TEXT,
  updated_at           INTEGER NOT NULL
);
