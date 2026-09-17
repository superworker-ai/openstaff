CREATE TABLE `computer_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`end_reason` text
);
--> statement-breakpoint
CREATE INDEX `computer_sessions_provider_ended_idx` ON `computer_sessions` (`provider`,`ended_at`);
--> statement-breakpoint
CREATE INDEX `turns_finished_idx` ON `turns` (`finished_at`);
