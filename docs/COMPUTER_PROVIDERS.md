# Computer providers

Choose one Computer in Settings. The provider choice is independent from where the
application is hosted. Provider credentials are workspace-scoped and encrypted in
SQLite; Settings takes precedence over the listed environment fallback.

| Provider | Configuration | Persistence | Desktop | Notes |
| --- | --- | --- | --- | --- |
| Local | no credential | host `DATA_DIR/workspace` | no | development and trusted single-node use |
| Docker | optional `DOCKER_HOST` | workspace plus `superworkers-home` volumes | yes | use `compose.docker.yml`; never expose a raw Docker socket in the default stack |
| E2B | `E2B_API_KEY`, optional `E2B_DESKTOP`, `E2B_DESKTOP_TEMPLATE` | paused microVM memory and filesystem plus native `/workspace` volume | yes | Firecracker desktop; falls back to durable-store sync when the account cannot create volumes |
| Daytona | `DAYTONA_API_KEY`, optional `DAYTONA_API_URL`, `DAYTONA_TARGET`, `DAYTONA_SNAPSHOT` | durable-store sync | no | native S3 or Archil mounts are a follow-up |
| Freestyle | `FREESTYLE_API_KEY`, optional `FREESTYLE_BASE_URL`, `FREESTYLE_SNAPSHOT_ID` | persistent VM plus durable-store sync | no | command strings wrap cwd and the scrubbed environment because the SDK exec API has no structured cwd/env fields |
| Vercel Sandbox | `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, optional `VERCEL_SANDBOX_IMAGE` | persistent sandbox plus durable-store sync | no | stopped sandboxes resume through the SDK on the next operation |

Remote Computers use `/workspace` as a virtual root. Their path jail is lexical;
the provider VM is the isolation boundary. Docker's browser runs in its persistent desktop;
E2B's browser runs headed in its Firecracker desktop and is attached over CDP. The Local,
Daytona, Freestyle, and Vercel Sandbox browsers remain on the server host. Stop-capable providers pause
after `COMPUTER_IDLE_MINUTES` and reconnect on the next operation.
The storage backend is independent of this choice. See [Workspace storage](STORAGE.md).

E2B templates must support passwordless `sudo`: opening a sandbox creates
`/workspace`, assigns it to the shell user, and verifies a shell write before
setting the command environment's `HOME=/workspace`. Failed initialization cleans
up newly created sandboxes. New instances create a named E2B volume and persist its id/name;
recreated sandboxes mount it again. A plan or permission failure is recorded once and switches
to store synchronization. Destroy removes both the E2B sandbox and its volume after the UI's
explicit confirmation.

E2B desktop mode is enabled unless `E2B_DESKTOP=0`. It uses
`E2B_DESKTOP_TEMPLATE` or `desktop`, starts at 1280×800, and preserves the complete
microVM filesystem and memory indefinitely while paused. E2B's continuous-runtime limit is
1 hour on Hobby and 24 hours on Pro; pause and resume reset that runtime clock. The default
desktop compute is approximately $0.17 per running hour. Existing shell-only `base` instances
are replaced once with the desktop template while reusing their `/workspace` volume.
The stock desktop template includes Chrome. A custom template with neither Chrome nor Chromium
triggers a one-time `apt` installation on first open, adding package-download time and bandwidth;
preinstall Chromium in custom templates to avoid that startup cost.

Hosted control revocation is coarse: returning or expiring a lease stops and restarts the E2B
stream to rotate its auth key. This invalidates the old controller URL and viewer URLs together,
so viewers fetch a fresh session URL and reconnect.

Application tests replace every registered provider with the fake, regardless of
the developer's `.env`. Live contract suites explicitly open the real adapters.
Docker contracts use unique container names and home volumes; E2B, Freestyle, and Vercel
Sandbox contracts track created IDs, destroy them even on failure, and verify their absence with the SDK.
Docker status distinguishes daemon connectivity from workspace conflicts and
missing resources; raw Docker error bodies, host paths, and headers stay private.

Modal and OpenComputer are not yet implemented.

## Adding a provider

Add one adapter file and one registry line. Before opening a PR, verify:

1. Capability flags are truthful.
2. Credentials and provider headers/error bodies can never enter logs, API responses, or turn events.
3. Idle pause/resume and destroy cleanup are implemented.
4. The shared Computer contract suite passes, including bytes, abort, timeout, output cap, and jail rejection.
5. Documentation covers credentials, lifecycle, and one-provider-only setup.
