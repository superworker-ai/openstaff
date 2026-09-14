ALTER TABLE approvals ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
--> statement-breakpoint
UPDATE approvals SET created_at = COALESCE((SELECT created_at FROM messages WHERE json_extract(attachments, '$[0].approvalId') = approvals.id ORDER BY seq LIMIT 1), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
