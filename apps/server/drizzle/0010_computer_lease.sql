CREATE TABLE `computer_lease` (
  `id` text PRIMARY KEY NOT NULL DEFAULT 'workspace' CHECK (`id` = 'workspace'),
  `owner_kind` text NOT NULL CHECK (`owner_kind` IN ('bot', 'human')),
  `owner_id` text,
  `owner_name` text,
  `epoch` integer NOT NULL DEFAULT 0,
  `acquired_at` text NOT NULL,
  `expires_at` text,
  `heartbeat_at` text,
  `reason` text
);
--> statement-breakpoint
INSERT INTO `computer_lease` (`id`, `owner_kind`, `owner_id`, `owner_name`, `epoch`, `acquired_at`, `expires_at`, `heartbeat_at`, `reason`)
VALUES ('workspace', 'bot', NULL, NULL, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL);
