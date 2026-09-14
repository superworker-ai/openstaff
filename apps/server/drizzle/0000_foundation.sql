PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `users` (`id` text PRIMARY KEY NOT NULL, `email` text NOT NULL, `name` text NOT NULL, `password_hash` text NOT NULL, `avatar` text, `role` text NOT NULL, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
CREATE TABLE `sessions` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `expires_at` text NOT NULL, FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);
--> statement-breakpoint
CREATE TABLE `workspace` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `computer_driver` text NOT NULL, `default_model` text NOT NULL, `reply_decision_model` text, `settings` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `bots` (`id` text PRIMARY KEY NOT NULL, `slug` text NOT NULL, `name` text NOT NULL, `avatar` text NOT NULL, `job` text NOT NULL, `instructions` text NOT NULL, `model` text, `reasoning_effort` text, `approval_policy` text NOT NULL, `status` text NOT NULL, `created_by` text NOT NULL, `created_at` text NOT NULL, FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action);
--> statement-breakpoint
CREATE UNIQUE INDEX `bots_slug_unique` ON `bots` (`slug`);
--> statement-breakpoint
CREATE TABLE `rooms` (`id` text PRIMARY KEY NOT NULL, `kind` text NOT NULL, `name` text, `section` text, `created_by` text NOT NULL, `last_message_at` text, `last_message_preview` text, FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action);
--> statement-breakpoint
CREATE TABLE `room_members` (`room_id` text NOT NULL, `member_kind` text NOT NULL, `member_id` text NOT NULL, `joined_at` text NOT NULL, PRIMARY KEY(`room_id`, `member_kind`, `member_id`), FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE TABLE `messages` (`id` text PRIMARY KEY NOT NULL, `room_id` text NOT NULL, `seq` integer NOT NULL, `author_kind` text NOT NULL, `author_id` text, `text` text NOT NULL, `mentions` text NOT NULL, `attachments` text NOT NULL, `turn_id` text, `client_request_id` text, `created_at` text NOT NULL, FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_room_seq_unique` ON `messages` (`room_id`,`seq`);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_author_request_unique` ON `messages` (`author_kind`,`author_id`,`client_request_id`);
--> statement-breakpoint
CREATE INDEX `messages_room_created_idx` ON `messages` (`room_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `turns` (`id` text PRIMARY KEY NOT NULL, `room_id` text NOT NULL, `bot_id` text NOT NULL, `trigger_message_id` text NOT NULL, `reply_mode` text NOT NULL, `status` text NOT NULL, `model` text NOT NULL, `model_messages` text NOT NULL, `usage` text, `error` text, `started_at` text, `finished_at` text, `handoff_depth` integer DEFAULT 0 NOT NULL, FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`trigger_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action);
--> statement-breakpoint
CREATE INDEX `turns_room_status_idx` ON `turns` (`room_id`,`status`);
--> statement-breakpoint
CREATE INDEX `turns_bot_status_idx` ON `turns` (`bot_id`,`status`);
--> statement-breakpoint
CREATE TABLE `turn_events` (`id` text PRIMARY KEY NOT NULL, `turn_id` text NOT NULL, `seq` integer NOT NULL, `type` text NOT NULL, `payload` text NOT NULL, `created_at` text NOT NULL, FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `turn_events_turn_seq_unique` ON `turn_events` (`turn_id`,`seq`);
--> statement-breakpoint
CREATE TABLE `approvals` (`id` text PRIMARY KEY NOT NULL, `turn_id` text NOT NULL, `room_id` text NOT NULL, `bot_id` text NOT NULL, `approval_id` text NOT NULL, `tool_name` text NOT NULL, `input` text NOT NULL, `summary` text NOT NULL, `status` text NOT NULL, `decided_by` text, `decided_at` text, FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_approval_id_unique` ON `approvals` (`approval_id`);
--> statement-breakpoint
CREATE INDEX `approvals_status_idx` ON `approvals` (`status`);
--> statement-breakpoint
CREATE TABLE `tasks` (`id` text PRIMARY KEY NOT NULL, `room_id` text NOT NULL, `title` text NOT NULL, `brief` text NOT NULL, `owner_bot_id` text NOT NULL, `created_by_kind` text NOT NULL, `created_by_id` text NOT NULL, `status` text NOT NULL, `handoff_from_bot_id` text, `created_at` text NOT NULL, `updated_at` text NOT NULL, FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`owner_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE no action);
--> statement-breakpoint
CREATE INDEX `tasks_room_owner_idx` ON `tasks` (`room_id`,`owner_bot_id`);
