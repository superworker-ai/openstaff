# Backup and restore

`pnpm db:backup` performs an online SQLite backup with `VACUUM INTO` at
`DATA_DIR/backups/openstaff-<timestamp>.db`. It copies a neighboring
`.secrets.key` file when `DATA_DIR/secrets.key` exists and retains the newest
`BACKUP_KEEP` backups (seven by default). Rotation recognizes both the new pattern and
legacy `superworkers-<timestamp>.db` backups.

With `WORKSPACE_STORE=s3`, upload that database and its key into the sibling bucket prefix
`S3_PREFIX/../backups/` while applying the same retention count:

```sh
pnpm db:backup --upload
```

Restore only while the server is stopped:

```sh
pnpm db:restore /path/to/openstaff-<timestamp>.db
pnpm db:restore s3://backups/openstaff-<timestamp>.db
```

The restore command rejects a live `DATA_DIR/server.lock`, copies the backup to a
temporary file in `DATA_DIR`, then atomically replaces the database. Keep the
database, `secrets.key`, and the whole workspace volume together. A database without
its matching key cannot decrypt saved model, plugin, or Computer credentials.
The active database is `DATA_DIR/openstaff.db`; when only `superworkers.db` from an older
install exists, backup and restore continue to use that legacy path automatically.

The S3 form uses the configured bucket and downloads the matching `.secrets.key` when present.
Object keys and credentials are not printed. `compose.litestream.yml` provides continuous SQLite
replication to `backups/litestream`; see [Storage](STORAGE.md) for its restore command and the
one-bucket drill.

Workspace objects are separate from SQLite backup objects. Durable bot memory, saved skills, and
uploads use the store's `workspace/` prefix. Files elsewhere in E2B, Daytona, Freestyle, or Vercel Sandbox remain provider-local
and are not covered by database backup.
