# Releases

OpenStaff uses SemVer. Keep changes under `Unreleased` in `CHANGELOG.md`, then
move them into a versioned section before creating a `vMAJOR.MINOR.PATCH` tag. A tag builds
amd64 and arm64 server, web, and Computer images in GHCR and publishes SBOM artifacts.
Tags never deploy an installation.

Read migration notes before upgrading. Migrations are forward-only: rollback means
redeploying the previous image and, when necessary, restoring a verified backup. An image
rollback does not reverse SQLite migrations.
