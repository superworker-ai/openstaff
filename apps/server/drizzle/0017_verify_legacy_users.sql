-- Pre-Better-Auth accounts kept a `scrypt:` password hash, so that prefix marks a user who signed up
-- before verification existed; mark them verified so requireEmailVerification cannot lock them out.
UPDATE `users` SET `email_verified` = 1 WHERE `id` IN (
	SELECT `user_id` FROM `account` WHERE `provider_id` = 'credential' AND `password` LIKE 'scrypt:%'
);
