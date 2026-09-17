CREATE TABLE `room_sections` (
	`user_id` text NOT NULL,
	`normalized_name` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `normalized_name`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
