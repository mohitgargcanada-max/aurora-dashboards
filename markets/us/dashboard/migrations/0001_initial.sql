CREATE TABLE IF NOT EXISTS scan_runs (
  id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL CHECK (run_type IN ('SUNDAY_WWL', 'WEEKDAY_MORNING')),
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  asof_eod_date TEXT,
  market_json TEXT,
  lanes_json TEXT,
  error_summary TEXT
);

CREATE TABLE IF NOT EXISTS candidate_snapshots (
  run_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  rank INTEGER,
  weekly_tier TEXT,
  execution_tier TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (run_id, ticker),
  FOREIGN KEY (run_id) REFERENCES scan_runs(id)
);

CREATE TABLE IF NOT EXISTS weekly_membership (
  week_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  first_selected_at TEXT NOT NULL,
  last_reviewed_at TEXT NOT NULL,
  carry_forward_weeks INTEGER NOT NULL DEFAULT 0,
  sessions_without_trigger INTEGER NOT NULL DEFAULT 0,
  weekly_tier TEXT NOT NULL,
  remove_reason TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (week_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_scan_runs_type_date ON scan_runs(run_type, asof_eod_date DESC);
CREATE INDEX IF NOT EXISTS idx_candidate_run_rank ON candidate_snapshots(run_id, rank);
