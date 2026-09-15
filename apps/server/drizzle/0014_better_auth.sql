ALTER TABLE `users` ADD `email_verified` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `updated_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `two_factor_enabled` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `banned` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `ban_reason` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `ban_expires` text;
--> statement-breakpoint
UPDATE `users` SET `updated_at` = `created_at`;
--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` text,
	`refresh_token_expires_at` text,
	`scope` text,
	`password` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_provider_account_unique` ON `account` (`provider_id`,`account_id`);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);
--> statement-breakpoint
INSERT INTO `account` (`id`, `account_id`, `provider_id`, `user_id`, `password`, `created_at`, `updated_at`)
SELECT 'acc_' || substr(`id`, 5), `id`, 'credential', `id`, `password_hash`, `created_at`, `created_at` FROM `users`;
--> statement-breakpoint
DROP TABLE `sessions`;
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`impersonated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `password_hash`;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_single_owner_idx` ON `users` ((`role` = 'owner')) WHERE `role` = 'owner';
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
--> statement-breakpoint
CREATE TABLE `two_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` text NOT NULL,
	`verified` integer DEFAULT 1 NOT NULL,
	`failed_verification_count` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `two_factor_secret_idx` ON `two_factor` (`secret`);
--> statement-breakpoint
CREATE INDEX `two_factor_user_idx` ON `two_factor` (`user_id`);
--> statement-breakpoint
CREATE TABLE `sso_provider` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`issuer` text NOT NULL,
	`domain` text NOT NULL,
	`oidc_config` text,
	`saml_config` text,
	`user_id` text,
	`domain_verified` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sso_provider_provider_id_unique` ON `sso_provider` (`provider_id`);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`accepted_at` text,
	`revoked_at` text,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `invitations_email_idx` ON `invitations` (`email`);
--> statement-breakpoint
CREATE INDEX `invitations_pending_idx` ON `invitations` (`expires_at`,`accepted_at`,`revoked_at`);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`actor_user_id` text,
	`actor_ip` text NOT NULL,
	`event` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`metadata` text NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`,`id`);
--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_user_id`);
