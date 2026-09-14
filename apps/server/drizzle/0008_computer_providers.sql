ALTER TABLE `turns` ADD `computer_provider` text;
--> statement-breakpoint

CREATE TABLE `computer_credentials` (
  `provider` text PRIMARY KEY NOT NULL,
  `encrypted` text NOT NULL,
  `updated_at` text NOT NULL,
  `updated_by` text REFERENCES `users`(`id`)
);
--> statement-breakpoint

CREATE TABLE `computer_instances` (
  `id` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL UNIQUE,
  `external_id` text NOT NULL,
  `status` text NOT NULL,
  `created_at` text NOT NULL,
  `last_seen_at` text NOT NULL,
  `metadata` text NOT NULL DEFAULT '{}'
);
