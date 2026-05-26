CREATE TABLE folders (
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  id            TEXT NOT NULL,
  provider_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  parent_id     TEXT,
  unread_count  INTEGER DEFAULT 0,
  total_count   INTEGER DEFAULT 0,
  delta_cursor  TEXT,
  PRIMARY KEY (account_id, id)
);

CREATE TABLE messages (
  account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  id                TEXT NOT NULL,
  folder_id         TEXT NOT NULL,
  provider_id       TEXT NOT NULL,
  thread_id         TEXT,
  from_addr         TEXT NOT NULL,
  to_addrs          TEXT NOT NULL,
  cc_addrs          TEXT DEFAULT '[]',
  subject           TEXT,
  received_at       INTEGER NOT NULL,
  preview           TEXT,
  has_attachments   INTEGER DEFAULT 0,
  is_read           INTEGER DEFAULT 0,
  is_flagged        INTEGER DEFAULT 0,
  is_draft          INTEGER DEFAULT 0,
  size_bytes        INTEGER,
  body_text         TEXT,
  body_html         TEXT,
  raw_headers       TEXT,
  fetched_at        INTEGER,
  PRIMARY KEY (account_id, id)
);

CREATE INDEX idx_messages_folder_date ON messages (account_id, folder_id, received_at DESC);
CREATE INDEX idx_messages_thread ON messages (account_id, thread_id);
