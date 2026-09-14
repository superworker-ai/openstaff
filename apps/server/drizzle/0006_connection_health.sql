ALTER TABLE approvals ADD COLUMN resume_mode TEXT NOT NULL DEFAULT 'tool';
--> statement-breakpoint
ALTER TABLE plugin_oauth ADD COLUMN last_checked_at TEXT;
--> statement-breakpoint
ALTER TABLE plugin_oauth ADD COLUMN refresh_error TEXT;
