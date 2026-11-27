-- v12 (backlog of the work-log edit, start plan V12_WORKLOG_IMPORT_START_PLAN.md part B; AGENTS.md §2.7): a work log is
-- edited from the payroll page by more than one colleague, so it carries its record version like every edited record. An
-- edit sends the version it read; a stale one is 409 OCC_CONFLICT instead of a silent overwrite. Every existing log starts
-- at 1. No other row changes. Runs inside the Drizzle migrator transaction.
ALTER TABLE piecework_logs ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE piecework_logs ADD CONSTRAINT chk_piecework_logs_version CHECK (version >= 1);
