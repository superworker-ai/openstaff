#!/bin/sh
set -eu

: "${S3_BUCKET:?S3_BUCKET is required}"
if { [ -n "${S3_ACCESS_KEY_ID:-}" ] && [ -z "${S3_SECRET_ACCESS_KEY:-}" ]; } || { [ -z "${S3_ACCESS_KEY_ID:-}" ] && [ -n "${S3_SECRET_ACCESS_KEY:-}" ]; }; then
  echo "Both S3 access key variables must be set together" >&2
  exit 1
fi
prefix="${S3_PREFIX:-workspace/}"
prefix="${prefix%/}"
parent="${prefix%/*}"
if [ "${parent}" = "${prefix}" ]; then parent=""; fi
backup_path="${parent:+${parent}/}backups/litestream"

{
  echo "dbs:"
  echo "  - path: /data/openstaff.db"
  echo "    replicas:"
  echo "      - type: s3"
  echo "        bucket: '${S3_BUCKET}'"
  echo "        path: '${backup_path}'"
  echo "        region: '${S3_REGION:-us-east-1}'"
  if [ -n "${S3_ACCESS_KEY_ID:-}" ] && [ -n "${S3_SECRET_ACCESS_KEY:-}" ]; then
    echo "        access-key-id: '${S3_ACCESS_KEY_ID}'"
    echo "        secret-access-key: '${S3_SECRET_ACCESS_KEY}'"
  fi
  if [ -n "${S3_ENDPOINT:-}" ]; then echo "        endpoint: '${S3_ENDPOINT}'"; fi
  if [ "${S3_FORCE_PATH_STYLE:-0}" = "1" ] || [ "${S3_PROVIDER:-other}" = "minio" ]; then echo "        force-path-style: true"; fi
} > /tmp/litestream.yml

exec litestream "$@"
