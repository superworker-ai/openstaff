# Implementation plan

Design of record: `docs/ARCHITECTURE.md`. Each phase must leave `pnpm typecheck`,
`pnpm lint`, `pnpm test` green and `pnpm dev` bootable.

## Phase 1 — Foundation (rooms, bots, agent loop, approvals, UI)

- [x] pnpm monorepo: `apps/web`, `apps/server`, `packages/shared`; root scripts `dev`, `build`,
  `typecheck`, `lint`, `test`, `db:migrate`.
- [x] `packages/shared`: zod schemas for every Phase 1 entity in §3, wire protocol (§8), id helpers.
- [x] `apps/server`: Hono + `ws`, drizzle/libsql SQLite with migrations, auth (email +
  password, scrypt, session cookie, optional `SIGNUP_CODE`), bots CRUD + templates, rooms
  and members, messages with per-room `seq` and `client_request_id`, WebSocket hub with
  subscriptions and presence, turn planner + scheduler (§4), agent runtime (§5) on the
  `local` Computer driver with tools `shell`, `read_file`, `write_file`, `edit_file`,
  `list_dir`, `read_skill`, `save_skill`, `memory_update`, `handoff`, `create_task`,
  `update_task`; approvals (§4.6) end to end; recovery on boot (§4.7).
- [x] `apps/web`: TanStack Start app with the three-pane UI (§10): login/signup, sidebar,
  thread with streaming pending bubble and approval cards, members panel, bot creation
  ("Meet a future teammate" with templates), room creation, room settings.
- [x] Tests (§11) for planner policy, seq/idempotency, approval resume, path jail, and the
  mock-model integration flow.

## Phase 2 — Plugins, Composio, automations

- [x] Phase 1 review fixes: scrubbed shell environment, recent attributed history,
  trigger attribution, sidebar ordering, conditional thread scroll, approval creation
  timestamps/expiry migration, and safe empty timestamps.
- [x] Cursor plugin loader and validator, marketplace index fetch and install, MCP clients
  (http + stdio) exposed as tools, rules/skills injection, plugin settings UI with
  variables.
- [x] Composio: connections, `composio_search`, `composio_execute`, `composio_link`,
  marketplace toolkit browser with Connect.
- [x] Automations: cron scheduler (croner) posting system messages; `create_automation` tool;
  automations settings page.
- [x] Settings: encrypted provider keys, shared model catalog, default model,
  reply-decision model, plugin variables, connections, and automation controls.
- [x] Regression tests, plugin fixtures, mocked Composio tests, injected automation clock,
  HTTP integration coverage, and real cron smoke run.

## Phase 3 — Computer, browser, activity panel, polish

- [x] Review fixes: explicit handoff provenance, anti-echo prompts, deduplicated missing-key
  notices, readable approvals, avatar spacing, grouped messages, hover timestamps, hydrated tabs.
- [x] Docker Computer driver, scrubbed exec environment, demux/timeouts, status/restart,
  Ubuntu computer image and production Compose stack with persistent data.
- [x] Playwright browser tools, ARIA refs, persistent profile, per-turn pages, screenshot
  events and authenticated screenshot endpoint, with real Chromium tests.
- [x] Computer panel: screenshots, compact live activity, task owner/status, token usage.
- [x] Cancellation, jailed multipart uploads, incremental room compaction and migration.
- [x] Stdio MCP pool: reuse, error invalidation, registry-change and shutdown cleanup.
- [x] MIT license, CONTRIBUTING, CI, complete local/Docker/browser documentation.
- [x] Typecheck/lint/tests, hydrated Marketplace browser test, Docker image/config/real exec,
  production builds and mock-model browser screenshot smoke proof.

## Phase 4 — Connections UX

- [x] Connection-gated MCP and Composio actions reuse approval pause/resume; verified
  callbacks resume with fresh credentials, Not now yields denied output, 24-hour expiry.
- [x] Install → Connect dialog, DCR sign-in, guided manual clients shared per issuer,
  plain-language callback errors, and standalone chat connection route.
- [x] Unified Apps catalog with shared aliases and status badges; Skills tab for plugins
  without MCP servers; hidden manifests remain excluded.
- [x] Apps prompt status, proactive `request_connection`, and unified Settings Connections
  with reconnect, disconnect, and forget-client actions.
- [x] Isolated fake-OAuth browser coverage for install, chat resume, and client reuse;
  MCP/Composio gating, callback verification, denial, encryption, and error-mapping tests.

## Phase 5 — Connections UX round 2

- [x] Same-origin, source-validated connection popups with callback completion messages;
  approval events resume cards without leaving chat.
- [x] Client-side `/connect` commands, status autocomplete, subtle message chips, and
  a room-scoped connection endpoint that reuses paused actions without extra model calls.
- [x] Expired execution credentials become Reconnect pauses with explicit retry context;
  only connected tools reach the model, with tool-count and hidden-app events.
- [x] Template app suggestions, no-model welcome messages, Members app status dots,
  inline Composio key setup, and a first-run checklist.
- [x] Half-hour MCP health checks, proactive token refresh, persisted check/error state,
  and live connection updates in chat and Settings.
- [x] Fake-clock health, aliases, tool filtering, denied/retry, and real-popup browser
  tests; screenshots captured using temporary data directories and ephemeral ports.

## Phase 5.1 — Marketplace pagination and catalog warming

- [x] Paginated `/api/marketplace/apps` and `/skills` with clamped limits, opaque
  `{ offset, q, version }` cursors, server-side ranked search, and restart-at-zero for
  stale, changed-query, or malformed cursors.
- [x] Composio catalog warmed at boot and key rotation, refreshed every 15 minutes, cold
  single-page fetches with provisional totals, and last-snapshot retention on failure.
- [x] Marketplace grid with infinite scroll, keyboard **Load more**, 250 ms debounced
  search, loading skeletons, 3-second warming refetch, and in-place Connect/Install
  patches that preserve loaded pages and scroll.
- [x] Group rooms: designated fallback reply when every optional turn declines, recorded
  decision errors, and queued "is thinking…" bubbles.
- [x] Pagination, catalog lifecycle, API, and real-Chromium marketplace tests; docs and
  README updated.

## Phase 6 — Computer providers and production shipping

- [x] Registry-backed Local, Docker, E2B, Daytona, Freestyle, and Vercel Sandbox Computers with encrypted workspace
  credentials, persisted instances, lock precedence, idle lifecycle, and metadata-only APIs.
- [x] Provider capability cards, generated credential forms, lifecycle actions, health/readiness,
  startup doctor, remote-safe uploads, and provider attribution on turns.
- [x] Canonical single-node Compose files, constrained Docker-provider overlay, production image
  overlay, online SQLite backup/restore scripts, and environment contract coverage.
- [x] OSS operating contract, self-hosting/provider/backup/release documentation, CI security and
  Compose smoke workflows, Dependabot, and tag-only image release workflow.
- [x] Review round 1: packaged Chromium, SDK error classification and bounded recovery,
  single-flight opens, polling-safe idle policy and status cache, production overlay and
  migration ordering fixes, shared gated contracts, manager/HTTP redaction regressions.

## Phase 6.1 — Durable workspace storage and volume attachment

- [x] Filesystem and S3-compatible `WorkspaceStore` backends for bot memory, saved skills,
  and room uploads, with jailed keys, multipart transfers, health reporting, and MinIO contracts.
- [x] Store-first writes, store-backed server reads, materialization on Computer open, bounded
  post-turn reconciliation, deletion fencing, a sync index, and owner-triggered sync status.
- [x] E2B native volume creation, persisted attachment metadata, recreation notices, runtime
  capability reporting, sync-only plan fallback, and sandbox-plus-volume destruction.
- [x] S3 backup upload/restore, Litestream and host-path Compose overlays, Archil mounting
  recipe, CI service coverage, environment contract, operational docs, and Settings proof.

## Phase 7 — Room automations

- [x] Shared automation, invocation, and run contracts with prefixed IDs and realtime updates.
- [x] Durable three-table model, legacy data migration, derived invocation status, and history.
- [x] Unified schedule, manual, and webhook admission with deduplication, overlap, catch-up, and failure strikes.
- [x] Authenticated automation API, bearer-key webhook ingress, payload limits, and rate limiting.
- [x] Room-native automation forms, templates, one-time webhook keys, status rows, and invocation history.
- [x] Workspace overview, realtime invalidation, regression coverage, and Chromium creation flow.

## Phase 8 — Computer v2: persistent desktop, live view, takeover

Design: `docs/COMPUTER-DESKTOP.md`. Work orders: `.context/research/codex-desktop-phaseA-workorder.md`.

- [x] A. Desktop image (KasmVNC + openbox + Chromium + s6), `superworkers-home` volume,
  `HOME=/home/worker`, Compose network/limits, driver creation fix, Chromium over CDP with
  tab adoption and display mutex, Hono desktop proxy (HTTP + WS), live view in the panel.
- [x] B. Control lease + takeover (epoch-checked bot input, controller stream, "Take over"
  on approval cards, audit events).
- [x] C. Computer use: native desktop screenshots in model tool results, pixel mouse/keyboard
  input, window listing/focus, shared display/lease gating, interleaved screenshot storage, and
  compact Computer-panel activity.
- [ ] D. xterm.js terminal over tmux, reset actions (browser/home/container), screenshot
  retention, setup-script re-application on image upgrade.
- [ ] Later: Neko WebRTC stream driver, E2B hosted driver, gVisor flag, per-bot screens.
