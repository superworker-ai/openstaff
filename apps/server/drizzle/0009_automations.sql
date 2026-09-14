CREATE TABLE `automations` (
  `id` text PRIMARY KEY NOT NULL,
  `room_id` text NOT NULL REFERENCES `rooms`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `trigger` text NOT NULL,
  `cron` text,
  `timezone` text NOT NULL,
  `prompt` text NOT NULL,
  `target_bot_ids` text NOT NULL,
  `overlap` text NOT NULL,
  `catch_up` integer NOT NULL DEFAULT 0,
  `enabled` integer NOT NULL DEFAULT 1,
  `paused_reason` text,
  `consecutive_failures` integer NOT NULL DEFAULT 0,
  `webhook_key_hash` text,
  `last_run_at` text,
  `next_run_at` text,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `automations_room_idx` ON `automations` (`room_id`);
--> statement-breakpoint
CREATE TABLE `automation_invocations` (
  `id` text PRIMARY KEY NOT NULL,
  `automation_id` text NOT NULL REFERENCES `automations`(`id`) ON DELETE CASCADE,
  `source` text NOT NULL,
  `scheduled_at` text,
  `trigger_key` text,
  `triggered_by` text,
  `message_id` text,
  `skip_reason` text,
  `failure_counted_at` text,
  `created_at` text NOT NULL,
  `completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_invocations_scheduled_unique` ON `automation_invocations` (`automation_id`, `scheduled_at`) WHERE `scheduled_at` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_invocations_trigger_unique` ON `automation_invocations` (`automation_id`, `trigger_key`) WHERE `trigger_key` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `automation_invocations_automation_created_idx` ON `automation_invocations` (`automation_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `automation_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `invocation_id` text NOT NULL REFERENCES `automation_invocations`(`id`) ON DELETE CASCADE,
  `automation_id` text NOT NULL REFERENCES `automations`(`id`) ON DELETE CASCADE,
  `bot_id` text NOT NULL,
  `turn_id` text,
  `skip_reason` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `automation_runs_invocation_idx` ON `automation_runs` (`invocation_id`);
--> statement-breakpoint
CREATE INDEX `automation_runs_turn_idx` ON `automation_runs` (`turn_id`);
--> statement-breakpoint
INSERT INTO `automations` (`id`, `room_id`, `name`, `trigger`, `cron`, `timezone`, `prompt`, `target_bot_ids`, `overlap`, `catch_up`, `enabled`, `paused_reason`, `consecutive_failures`, `webhook_key_hash`, `last_run_at`, `next_run_at`, `created_by`, `created_at`, `updated_at`)
SELECT `id`, `room_id`, `name`, 'schedule', `cron`, `timezone`, `prompt`, json_array(`bot_id`), 'skip', 0, `enabled`, CASE WHEN `enabled` THEN NULL ELSE 'manual' END, 0, NULL, `last_run_at`, `next_run_at`, `created_by`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM `routines`;
--> statement-breakpoint
DROP TABLE `routines`;
