/** DDL تمهيدي تراكمي — يُنفَّذ عند كل إقلاع بأمان (IF NOT EXISTS) */
export const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guides (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  step_count INTEGER NOT NULL DEFAULT 0,
  thumb_file_id TEXT,
  folder_id TEXT,
  starred INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shares (
  guide_id TEXT PRIMARY KEY REFERENCES guides(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  views INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS step_comments (
  id TEXT PRIMARY KEY,
  guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  parent_id TEXT,
  author TEXT NOT NULL DEFAULT '',
  is_owner INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_step_comments_guide ON step_comments(guide_id);

CREATE VIRTUAL TABLE IF NOT EXISTS guide_index USING fts5(
  guide_id UNINDEXED,
  step_id UNINDEXED,
  step_no UNINDEXED,
  field UNINDEXED,
  norm_text,
  raw_text UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
`
