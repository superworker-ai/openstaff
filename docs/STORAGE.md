# Workspace storage

OpenStaff separates two concerns:

1. The durable store is the source of truth for `bots/`, `skills/`, and `uploads/`, including
   while no Computer exists.
2. The attachment determines how the active Computer sees `/workspace`: a host directory,
   Docker mount, E2B volume, or server-driven synchronization.

Changing a Computer provider does not change the durable store. Files outside the three durable
prefixes remain provider-local and may disappear when a sandbox or container is destroyed.

## Filesystem

This default stores durable files directly in `DATA_DIR/workspace`:

```dotenv
WORKSPACE_STORE=fs
```

Local and Docker use that same directory or volume, so there is no second copy. Use this mode
for an Archil-backed host mount too.

## AWS S3

```dotenv
WORKSPACE_STORE=s3
S3_PROVIDER=aws
S3_ENDPOINT=
S3_REGION=us-east-1
S3_BUCKET=my-openstaff-bucket
S3_PREFIX=workspace/
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=0
```

Leave the access-key variables empty to use the AWS SDK credential chain, such as an instance
role. Grant bucket head/list plus object get, put, delete, and multipart permissions for the
workspace and backup prefixes.

## Cloudflare R2

```dotenv
WORKSPACE_STORE=s3
S3_PROVIDER=r2
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=my-openstaff-bucket
S3_PREFIX=workspace/
S3_ACCESS_KEY_ID=<r2-access-key-id>
S3_SECRET_ACCESS_KEY=<r2-secret-access-key>
S3_FORCE_PATH_STYLE=0
```

R2 automatically uses checksum calculation and validation only when required.

## MinIO and other S3-compatible stores

```dotenv
WORKSPACE_STORE=s3
S3_PROVIDER=minio
S3_ENDPOINT=http://minio.example.internal:9000
S3_REGION=us-east-1
S3_BUCKET=openstaff
S3_PREFIX=workspace/
S3_ACCESS_KEY_ID=<minio-access-key>
S3_SECRET_ACCESS_KEY=<minio-secret-key>
S3_FORCE_PATH_STYLE=1
```

Use `S3_PROVIDER=other` for another compatible service and set its endpoint, region, and path
style requirement explicitly. Storage credentials are environment-only and never appear in
Settings, health responses, events, or errors.

## E2B volumes

When E2B creates a sandbox, it creates or reuses `openstaff-workspace-<instance-id>` and mounts
the volume at `/workspace`. Its id and name are stored in `computer_instances.metadata`, so a
replacement sandbox mounts the same volume. The durable store is still authoritative and is
materialized/reconciled as a portable backup across providers.

If E2B rejects volume creation because of the account plan or permissions, OpenStaff records the
decision, reports the runtime `volume` capability as false, and uses synchronization only. It does
not retry on each open. Destroying the Computer permanently removes both its sandbox and attached
E2B volume; the durable store remains.

## Archil host-path attachment

Create an Archil disk in the Archil console with an S3, R2, or S3-compatible storage mount and a
dedicated bucket prefix. Authorize the server and retain the disk token outside this repository.
On the Linux Docker host:

```sh
curl -s https://archil.com/install | sh
sudo mkdir -p /mnt/archil
export ARCHIL_MOUNT_TOKEN="<disk-token>"
sudo --preserve-env=ARCHIL_MOUNT_TOKEN archil mount <disk-name> /mnt/archil --region <disk-region>
sudo mkdir -p /mnt/archil/workspace
sudo chown -R 1000:1000 /mnt/archil
```

For startup mounting, keep the token available to the Archil mount helper and add this line:

```fstab
<owner>/<disk-name> /mnt/archil archil _netdev,region=<disk-region>,defaults 0 0
```

Then configure the filesystem backend and host bind:

```dotenv
WORKSPACE_STORE=fs
WORKSPACE_HOST_PATH=/mnt/archil/workspace
```

```sh
docker compose -f docker-compose.yml -f compose.hostpath.yml up -d
```

This Local-provider configuration binds the server at `/data/workspace` and starts no Computer
container. For Docker, set `COMPUTER_VIEWER_PASSWORD` and `COMPUTER_CONTROLLER_PASSWORD`, then use:

```sh
docker compose -f docker-compose.yml -f compose.docker.yml -f compose.hostpath.yml -f compose.docker.hostpath.yml up -d
```

The Docker-specific overlay also binds the Computer at `/workspace`. Apply it after the Docker
overlay; it preserves the selected Computer image. It never grants FUSE devices or capabilities to the
Computer container. Do not point the S3 adapter and Archil at the same object prefix concurrently.
See the [official Archil Linux mount guide](https://docs.archil.com/mounting/linux).

Daytona native S3 or Archil attachment is a follow-up. Daytona currently uses the universal
server-driven sync path.

Reconciliation uses one inventory exec and an uncapped temporary report under `.openstaff/`,
followed by a cleanup exec. Linux requires Python 3, GNU find, and sha256sum; Local development
on macOS uses Python's filesystem metadata. Only files with a changed size or mtime are hashed,
and files above 20 MB are never hashed. The SQLite index caches mtime and skill descriptions.
Settings counts and prompt skill indexes read SQLite, while storage health is cached for 15 seconds.

## SQLite backups and Litestream

With any S3 store configuration, upload an online SQLite snapshot and `secrets.key`:

```sh
pnpm db:backup --upload
```

The command keeps `BACKUP_KEEP` local and remote snapshots under the sibling `backups/` prefix.
Restore only with the server stopped:

```sh
pnpm db:restore s3://backups/openstaff-<timestamp>.db
```

For continuous replication, add `compose.litestream.yml`. It generates its config from `S3_*`
at container start and writes to `backups/litestream` in the same bucket:

```sh
docker compose -f docker-compose.yml -f compose.litestream.yml up -d
```

To restore Litestream into an empty data volume, stop the server, move the damaged database out
of `DATA_DIR`, then run:

```sh
docker compose -f docker-compose.yml -f compose.litestream.yml run --rm litestream restore -config /tmp/litestream.yml /data/openstaff.db
```

## One-bucket restore drill

1. Configure `S3_PREFIX=workspace/`, run the doctor, create a bot, upload a marker, and run
   `pnpm db:backup --upload`.
2. Record the generated local backup filename. Confirm the bucket has `workspace/`,
   `backups/<filename>`, its `.secrets.key` companion, and optionally `backups/litestream/`.
3. Stop OpenStaff. Move the local database and workspace aside rather than deleting them.
4. Restore with `pnpm db:restore s3://backups/<filename>` and start OpenStaff.
5. Confirm users, rooms, and encrypted settings from SQLite, then use Settings → Computer →
   Storage → Sync now and confirm bot memory, skills, and uploads materialize from the same bucket.
6. Remove the drill copies only after verification.
