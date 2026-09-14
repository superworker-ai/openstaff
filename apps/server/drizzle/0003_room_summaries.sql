CREATE TABLE room_summaries (
  room_id TEXT PRIMARY KEY NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  up_to_seq INTEGER NOT NULL,
  summary TEXT NOT NULL,
  last_compacted_seq INTEGER NOT NULL
);
