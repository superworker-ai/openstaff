ALTER TABLE approvals ADD COLUMN kind TEXT NOT NULL DEFAULT 'approval';
--> statement-breakpoint
ALTER TABLE approvals ADD COLUMN connection TEXT;
--> statement-breakpoint
ALTER TABLE plugin_oauth ADD COLUMN approval_id TEXT;
--> statement-breakpoint
ALTER TABLE plugin_oauth ADD COLUMN error TEXT;
--> statement-breakpoint
CREATE TABLE oauth_clients (issuer TEXT PRIMARY KEY NOT NULL, client_id TEXT NOT NULL, client_secret TEXT);
