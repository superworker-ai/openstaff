CREATE TABLE plugins (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, source TEXT NOT NULL, root_path TEXT NOT NULL, manifest TEXT NOT NULL, enabled INTEGER NOT NULL, variables TEXT NOT NULL, installed_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE provider_keys (provider TEXT PRIMARY KEY NOT NULL, encrypted_key TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE connections (id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, toolkit TEXT NOT NULL, composio_connected_account_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE routines (id TEXT PRIMARY KEY NOT NULL, bot_id TEXT NOT NULL, room_id TEXT NOT NULL, name TEXT NOT NULL, cron TEXT NOT NULL, timezone TEXT NOT NULL, prompt TEXT NOT NULL, enabled INTEGER NOT NULL, last_run_at TEXT, next_run_at TEXT, created_by TEXT NOT NULL);
