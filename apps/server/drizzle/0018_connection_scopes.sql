ALTER TABLE `connections` ADD `scope` text DEFAULT 'workspace' NOT NULL;
--> statement-breakpoint
ALTER TABLE `connections` ADD `user_id` text;
--> statement-breakpoint
CREATE INDEX `connections_toolkit_scope_user_idx` ON `connections` (`toolkit`,`scope`,`user_id`);
--> statement-breakpoint
ALTER TABLE `turns` ADD `actor_user_id` text;
