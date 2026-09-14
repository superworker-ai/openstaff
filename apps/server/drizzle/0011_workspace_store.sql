CREATE TABLE `durable_files` (
  `key` text PRIMARY KEY NOT NULL,
  `sha256` text NOT NULL,
  `size` integer NOT NULL,
  `updated_at` text NOT NULL,
  `source` text NOT NULL
);
