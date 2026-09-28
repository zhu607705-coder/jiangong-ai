CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  input JSONB NOT NULL,
  context_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision INTEGER NOT NULL,
  context_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  execution_mode TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  snapshot_hash TEXT NOT NULL,
  decision JSONB,
  error_code TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, revision),
  UNIQUE(project_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_run_per_project ON runs(project_id) WHERE status = 'running';
CREATE TABLE IF NOT EXISTS run_events (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  artifact_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  kind TEXT NOT NULL,
  dependency_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  UNIQUE(project_id, kind, dependency_hash)
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  file_name TEXT NOT NULL,
  blob_name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  parser_result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, sha256)
);
CREATE TABLE IF NOT EXISTS followups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, run_id, title)
);
