CREATE TABLE plugin_oauth (
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  server_name TEXT NOT NULL,
  client_information TEXT,
  tokens TEXT,
  code_verifier TEXT,
  state TEXT,
  authorization_server TEXT,
  scopes TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, server_name)
);
CREATE UNIQUE INDEX plugin_oauth_state_idx ON plugin_oauth(state);
