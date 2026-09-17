CREATE TABLE `sso_provider_phase_b` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`issuer` text NOT NULL,
	`domain` text NOT NULL,
	`oidc_config` text,
	`saml_config` text,
	`user_id` text,
	`organization_id` text,
	`domain_verified` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `sso_provider_phase_b` (`id`,`provider_id`,`issuer`,`domain`,`oidc_config`,`saml_config`,`user_id`,`domain_verified`)
SELECT `id`,`provider_id`,`issuer`,`domain`,`oidc_config`,`saml_config`,`user_id`,`domain_verified` FROM `sso_provider`;
--> statement-breakpoint
DROP TABLE `sso_provider`;
--> statement-breakpoint
ALTER TABLE `sso_provider_phase_b` RENAME TO `sso_provider`;
--> statement-breakpoint
CREATE UNIQUE INDEX `sso_provider_provider_id_unique` ON `sso_provider` (`provider_id`);
--> statement-breakpoint
UPDATE `workspace` SET `settings` = json_set(`settings`, '$.auth', json('{"ssoOnly":false,"requireTwoFactor":false}')) WHERE json_type(`settings`, '$.auth') IS NULL;
