# OpenStaff — Architecture

An open-source implementation of xAI's **Grok Bot**: a roster of named, always-on AI
teammates ("Bots") that share one cloud computer, talk to humans and to each other in
iMessage-style rooms, use plugins for the apps you already use, and keep working while you
are offline.

This document is the design of record. Implementation phases are in `docs/PLAN.md`.

## 1. Product model (what we are cloning)

| Grok Bot concept | Ours |
| --- | --- |
| Bot: persistent named teammate with a job, memory, preferences | `bots` row + `bots/<slug>/` directory on the shared computer (MEMORY.md, skills, files) |
| Shared cloud computer (browser, filesystem, terminal), one per account | One `Computer` per workspace. Drivers: `local` (dev), `docker` (default). Browser via Playwright with a persistent context per workspace |
| "Each Bot gets its own screen" | Turns reuse the visible desktop tab; `newTab` opens another, and tabs persist across turns; screenshots stream to the **Computer** panel |
| Plugins: Cursor plugin format (skills, rules, agents, MCP servers, hooks) + Composio for 1000+ apps | `plugins` loader for `.cursor-plugin/plugin.json`, MCP client for `mcp.json`, Composio meta-tools |
| Group chats (2–6 bots), bot-to-bot messages, task handoff | `rooms` (kind `dm` or `group`), `@mention` addressing, `handoff` tool, `tasks` table |
| Approvals for consequential actions | AI SDK `toolApproval` → `approvals` table → approval card in chat → resume turn |
| Skills and automations (demonstrate once, rerun on a schedule or webhook) | `save_skill` tool writes `SKILL.md`; automations fire immutable per-bot runs into a room |
| Simple messaging UI, no tool-call noise | Chat shows only messages, "working…" indicator, and approval cards. Tool activity lives in the side panel |

Non-goals for v1: multi-tenant orgs, mobile apps, voice, computer-use vision model driving
arbitrary desktop apps (browser automation only), human takeover of the browser.

## 2. Topology

```
apps/web  (TanStack Start, React 19, Vite, Tailwind v4)   ──HTTP /api/*──▶  apps/server (Node 22, Hono)
   │                                                                          │
   └────────────────────── WebSocket /ws ─────────────────────────────────────┤
                                                                              ├─ SQLite (libsql + drizzle)   data/openstaff.db
                                                                              ├─ Scheduler (room turn queue, automations)
                                                                              ├─ Agent runtime (AI SDK v7 ToolLoopAgent)
                                                                              ├─ Computer manager (local | docker | e2b | daytona | freestyle | vercel) + Playwright
                                                                              ├─ Plugin host (cursor plugins, MCP clients)
                                                                              └─ Composio client
packages/shared   zod schemas, ids, wire protocol (events), plugin manifest types
```

On startup, if only `data/superworkers.db` from an older install exists, it is renamed to
`data/openstaff.db` (with any SQLite sidecar files) before the database is opened, so exactly one
database file exists. If both files exist the server uses `openstaff.db` and logs a warning.

Single process, single tenant ("workspace"). Every registered user is a member of the one
workspace, mirroring Open-Inspect's single-tenant security model. Multi-tenant isolation is
out of scope and must not be faked.

In dev, `apps/web` (Vite on :3000) proxies `/api` and `/ws` to `apps/server` on :8787. In
prod, run both behind one origin (Caddy/nginx) or set `PUBLIC_API_URL`.

## 3. Data model (SQLite, drizzle)

IDs are prefixed ULIDs (`usr_`, `bot_`, `room_`, `msg_`, `turn_`, `apr_`, `task_`, `plg_`,
`aut_`, `inv_`, `run_`). Timestamps are ISO strings in UTC. Migrated automation rows may retain
their historical `rtn_` identifiers.

- `users` — id, email (unique), name, password_hash (scrypt), avatar, created_at
- `sessions` — id, user_id, expires_at (cookie `sw_session`, HttpOnly, SameSite=Lax)
- `workspace` — singleton: id, name, computer_driver, default_model, settings JSON
- `bots` — id, slug (unique), name, avatar `{shape, color, eyes, mouth, accessory, personality}`
  (legacy rows with only shape and color resolve to face and personality defaults),
  job (one line), instructions (markdown), model (`provider/model` or null → workspace
  default), reasoning_effort, approval_policy (`auto` | `writes` | `all`), status
  (`idle` | `working` | `waiting_approval`), created_by, created_at
- `rooms` — id, kind (`dm` | `group`), name (null for dm → bot name), section (nullable
  string), created_by, last_message_at, last_message_preview
- `room_members` — room_id, member_kind (`user` | `bot`), member_id, joined_at. A `dm`
  room has exactly one bot member; humans can be many.
- `messages` — id, room_id, seq (per-room monotonic, unique (room_id, seq)), author_kind
  (`user` | `bot` | `system`), author_id, text (markdown), mentions JSON (`[{kind,id}]`),
  attachments JSON, turn_id (nullable, the turn that produced it), client_request_id
  (unique per author; idempotent posting), created_at
- `turns` — id, room_id, bot_id, trigger_message_id, reply_mode (`direct` | `optional`),
  status (`queued` | `running` | `waiting_approval` | `done` | `skipped` | `failed` |
  `cancelled`), model, model_messages JSON (AI SDK ModelMessage[] for resume), usage JSON
  (tokens, cost), error, started_at, finished_at, handoff_depth
- `turn_events` — id, turn_id, seq, type (`tool-call` | `tool-result` | `text` |
  `reasoning` | `screenshot` | `status`), payload JSON, created_at. Never rendered in the
  message thread; drives the Activity panel.
- `approvals` — id, turn_id, room_id, bot_id, approval_id (AI SDK), tool_name, input JSON,
  summary, status (`pending` | `approved` | `denied` | `expired`), decided_by, decided_at, created_at
- `tasks` — id, room_id, title, brief, owner_bot_id, created_by_kind/id, status (`open` |
  `in_progress` | `done` | `cancelled`), handoff_from_bot_id, created_at, updated_at
- `automations` — durable room configuration: id, room_id, name, trigger (`schedule` |
  `webhook`), cron, timezone, prompt, target_bot_ids JSON, overlap (`skip` | `queue`),
  catch_up, enabled, paused_reason, consecutive_failures, webhook_key_hash, last_run_at,
  next_run_at, created_by, created_at, updated_at
- `automation_invocations` — one schedule, manual, or webhook firing with atomic schedule and
  trigger-key deduplication, attribution, optional message, skip reason, and completion accounting
- `automation_runs` — immutable target snapshot for one invocation, one row per resolved bot;
  `turn_id` links to live turn status, while a null turn with a skip reason records a dropped run
- `plugins` — id, name (manifest name), source (`marketplace:<name>` | git URL | local path),
  root_path, manifest JSON, enabled, variables JSON (encrypted at rest with
  `SECRETS_KEY`), installed_at
- `connections` — id, provider (`composio`), toolkit slug, composio_connected_account_id,
  status, created_at. Shared by all bots (Grok Bot: "plugins are shared across agents").
- `provider_keys` — provider (`xai` | `anthropic` | `openai` | `opencode` | `composio` | `aiGateway`),
  encrypted key. Database keys take precedence over environment values; clearing a
  saved key restores the environment fallback. The API only returns configured flags.
- `room_summaries` — room_id, up_to_seq, summary (compaction output)
- `durable_files` — workspace-relative key, SHA-256, byte size, update time, and source for
  materialization and reconciliation of durable workspace paths

## 4. Rooms and turn scheduling (multiplayer)

Rules, taken from the observed Grok Bot behaviour ("Same room, separate turns. You post
here, each of us gets a turn if we have something to say. @ someone and that person usually
goes. We skip the turn when it's not our lane.") and from the Rooms policy in the sibling
`sw-chat` project:

1. **Admission.** A message is inserted with the next `seq` for its room inside a
   transaction. Then a *conversation run* is planned for that message:
   - `dm` room, human author → one `direct` turn for the bot.
   - `group` room, human author → every bot mentioned by `@name`, `@slug`, or by its name or
     slug used as a standalone word gets a `direct` turn (in mention order); every other bot
     member gets an `optional` turn. Longer single-word names and slugs tolerate one inserted,
     deleted, or substituted character. If no bot is mentioned, all bots get `optional` turns.
   - Bot author → only mentions carrying `handoff:true`, issued by the handoff tool,
     get `direct` turns, and only if `handoff_depth < 3`. Free-text bot mentions never
     schedule turns. Human mentions keep their direct/optional behavior.
   - `system` author (automation firing) → one `direct` turn per target bot.
2. **Ordering.** Turns within a room run **one at a time** in the order planned. Direct
   turns before optional turns. A bot has at most one running turn globally (it has one
   screen). Global concurrency cap `MAX_CONCURRENT_TURNS` (default 3).
3. **Optional turns** first run a cheap *reply decision* (structured output, no tools,
   bounded room history, 6 s timeout, using `REPLY_DECISION_MODEL` or the bot's model):
   `{ reply: boolean, reason }`. Reply only when the bot has a unique, material
   contribution (its lane, a correction, a blocker). `false` → status `skipped`, nothing is
   posted, nothing is shown. Exception: for a human-authored message, if every optional turn
   declines, the last one replies anyway so a human is never met with silence. Decision errors
   are recorded on the skipped turn and do not trigger the fallback. Missing provider keys
   generate one system notice per trigger across optional turns. Optional turns wait until the
   message's direct turns finish so they can see those replies, with the last three same-trigger
   bot replies labeled explicitly. Agreement, acknowledgement, emoji-only responses and
   restatements are rejected.
4. **Direct turns** run the full agent loop (§5). The final assistant text becomes one
   `bot` message. Empty text → `skipped`. While queued, the room shows "<bot> is
   thinking…". While running, it shows "<bot> is working…", and the text streams into a
   pending bubble via `message.delta` events.
5. **Handoff.** The `handoff` tool posts a bot message `@target <brief>` and creates/updates
   a `tasks` row with `owner_bot_id = target`. Admission of that message yields a `direct`
   turn with `handoff_depth = parent + 1`.
6. **Approvals.** The loop collects every non-automatic `tool-approval-request`, persists
   the full `model_messages`, inserts one `approvals` row and system card per request in
   order, and sets `waiting_approval` once. The room lock is released so humans can chat.
   Each decision updates its own card; only the final pending decision re-queues the turn.
   Missing `tool-approval-response` parts are appended in approval creation order, without
   duplicating earlier steps' responses. Approved and denied calls may coexist with automatic
   tool results. Optional decision reasons are preserved in status `turn_events`.
   When a pending approval reaches 24 h after `created_at`, all remaining pending approvals
   for that turn expire, the turn fails, and one system note is posted. Expiry is checked on
   boot, every minute, and before accepting decisions.
7. **Idempotency and recovery.** `client_request_id` dedupes posts. On server start, turns
   in `running` are marked `failed` with a system note; `queued` turns are re-run;
   `waiting_approval` turns stay (their state is persisted).
8. **Compaction.** When a room exceeds `CONTEXT_MESSAGES` (default 60), the older half is
   summarized into `room_summaries` by the reply-decision model; the prompt then contains
   `summary + tail`.

## 5. Agent runtime

One turn = one `ToolLoopAgent.stream()` call (AI SDK v7; always verify APIs against
`node_modules/ai/docs`). Model resolved from the bot, else workspace default, else
`xai/grok-4.6`. Providers: `@ai-sdk/xai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, and
`@ai-sdk/openai-compatible`, plus Vercel AI Gateway when `AI_GATEWAY_API_KEY` is set
(gateway-style `provider/model` ids everywhere). OpenCode Zen (`opencode/*`) and Go
(`opencode-go/*`) share `OPENCODE_API_KEY` and bypass AI Gateway. Their model prefix selects
the Anthropic, OpenAI, or OpenAI-compatible SDK and their respective direct endpoint.
Reasoning effort is not configurable for OpenCode models, and Go quotas are per OpenCode account.
Go refuses anonymous traffic, so every OpenCode request carries `x-opencode-session` (the
`botId:roomId` conversation, or `compaction:<roomId>`) and an `openstaff/<version>` user agent.
Go serves DeepSeek models from China only after an explicit opt-in in the OpenCode workspace
settings; without it the request fails with a provider error naming the opt-in page.

System prompt (in order):
1. Identity: name, job, instructions, roster of the room (who is here, their jobs).
2. Room contract: you are in a group/dm; reply concisely like a teammate in chat; use
   handoff tools for delegation, not free-text mentions; address humans by first name
   or nothing; never agree/acknowledge/repeat without adding something new; stay in your lane; never narrate tool
   calls; reply with nothing (empty) if you have nothing to add; ask for approval only
   through tools.
3. Memory: contents of `bots/<slug>/MEMORY.md` (capped 8 KB).
4. Skills index: name + description of every skill from enabled plugins and
   `skills/` on the computer. Bodies are loaded on demand with `read_skill`.
5. Rules: `alwaysApply` rules from enabled plugins.
6. Tasks: open tasks owned by this bot in this room.
7. Room history: `room_summaries` + last N messages rendered as `[author] text`, then
   the trigger message as the final user message.

Tools (every tool carries `toolsContext` with turn/bot/room ids and executes server-side):

| Tool | Notes |
| --- | --- |
| `shell` | run command on the Computer, cwd `/workspace`, 120 s timeout, output capped 16 KB |
| `read_file`, `write_file`, `list_dir`, `edit_file` | path-jailed to `/workspace` |
| `browser_navigate`, `browser_snapshot` (accessibility tree), `browser_click`, `browser_type`, `browser_screenshot` | Playwright, persistent context per workspace; turns reuse the visible desktop tab, `newTab` opens another, and tabs persist across turns |
| `computer_screenshot`, `computer_click`, `computer_double_click`, `computer_right_click`, `computer_move`, `computer_drag`, `computer_type`, `computer_key`, `computer_scroll`, `computer_wait` | Native 1280×800 Docker desktop vision/input; image results retain 1:1 pixel coordinates |
| `computer_windows`, `computer_focus_window` | List and activate Docker desktop windows with wmctrl |
| `read_skill`, `save_skill` | skills live at `/workspace/skills/<name>/SKILL.md` |
| `memory_update` | replace/append `MEMORY.md` |
| `handoff` | `{ to_bot, brief, task_id? }` |
| `create_task`, `update_task` | tasks ledger |
| `create_automation` | cron + prompt, bound to this bot and room |
| `composio_search` | search Composio tools by use case, only in connected toolkits |
| `composio_execute` | execute a slug with args; write actions require approval per policy |
| `request_connection` | asks for an app connection using the approval pause, without executing an app action |
| `mcp_*` | tools from enabled plugins' MCP servers, namespaced `<plugin>__<tool>` |

Approval policy (`toolApproval` generic function): `all` → every tool; `writes` → `shell`,
`write_file`, `edit_file`, `browser_click`, `browser_type`, desktop click/drag/type/key/scroll/focus tools, `composio_execute` (when the
tool is not read-only per Composio metadata), any MCP tool not annotated `readOnlyHint`;
`auto` → none. Limits per turn: 40 steps, 900 s, `maxOutputTokens` 4096 per step.

Every step emits `turn_events` (persisted, capped 2000 per turn) and is broadcast over
the WebSocket for the Activity panel; text deltas are broadcast but not persisted
individually.

## 6. Computer

`Computer` is the interaction contract: `exec(cmd, {cwd, timeoutMs}) → {stdout, stderr,
code}`, `readFile`, `readFileBytes`, `writeFile` (text or bytes), `mkdir`, `list`, `stat`, and `root`.
Remote roots are always the virtual `/workspace`; each provider lexically jails paths there.
The VM boundary is the remote-provider isolation boundary. `ManagedComputer` adds status,
restart, optional stop, destroy, and close.

`ComputerManager` resolves exactly one provider in this order: `COMPUTER_DRIVER` (which locks
Settings), then `workspace.computer_driver`, then local. It keeps one persisted instance row per
provider and an encrypted workspace-scoped credential record per commercial provider. Settings
credentials win over environment fallbacks and never leave the server. A turn records the chosen
provider at start; Settings cannot switch providers while a turn runs or awaits approval.

- `local` — a host directory (`DATA_DIR/workspace`), commands via `child_process`.
- `docker` — one long-lived `superworkers/computer` desktop container with `/workspace` and
  `/home/worker` mounted from named volumes in Compose.
- `e2b` — a persistent E2B sandbox from `E2B_TEMPLATE` or `base`, with a named native
  volume mounted at `/workspace` when the account permits it.
- `daytona` — a persistent Daytona sandbox from `DAYTONA_SNAPSHOT` or the SDK default.
- `freestyle` — a persistent Freestyle VM from `FREESTYLE_SNAPSHOT_ID` or the SDK default.
- `vercel` — a persistent Vercel Sandbox from `VERCEL_SANDBOX_IMAGE` or the SDK universal image.

Providers register through a small server registry. Each declares capability truthfully
(`persistent`, `snapshots`, `explicitStop`, `hostFiles`, `desktop`, `volume`), credential fields, a cheap validation
call, and `open`; adding a provider is one adapter file, one registry entry, tests, and docs.
Remote commands receive the same scrubbed environment as Docker and cap output at 16 KB.
After `COMPUTER_IDLE_MINUTES` (30 by default), stop-capable providers pause; the next file or
command call reconnects automatically.
Concurrent opens share one promise. Status reads share a 15-second cache and neither
wake a paused instance nor postpone idle shutdown; completed non-turn file/exec work
re-arms idle shutdown. E2B refreshes its timeout at most once per five minutes and
reconnects/retries once on SDK missing/non-running sandbox errors. Missing persisted
instances are recreated once; authentication failures never trigger creation.
E2B stores its volume id and name in `computer_instances.metadata`. A missing sandbox is
recreated against that volume. If volume creation is rejected by the account plan or permissions,
the active runtime reports `volume: false`, records the fallback in metadata, and relies on
storage synchronization without retrying volume creation on every open. Recreation is surfaced
through status and `computer.notice`; destroying an E2B Computer also destroys its volume.

The Docker provider runs one disposable Ubuntu desktop container with KasmVNC `:1`, openbox,
tint2, and one long-lived headed Chromium as non-root `worker`. KasmVNC and CDP listen only on
the private Compose network. The authenticated same-origin `/api/computer/desktop/*` HTTP and
WebSocket proxy injects the read-only viewer identity, and the Computer panel embeds its client.
The server drives that same Chromium over CDP: turns reuse the visible desktop tab, `newTab` opens
another, and tabs persist across turns. It re-adopts tabs by target id after a disconnect and
serializes visible actions through a per-workspace display mutex.

A singleton control lease arbitrates browser input between bots and workspace members. Human
takeover increments a fenced epoch, grants the requesting member KasmVNC's controller identity,
pauses browser tools, and expires without heartbeats; release or expiry returns the lease to the
bot, closes stale controller sockets, records activity on active turns, and forces browser tools
to capture a fresh observation before continuing. Preview sockets always use the viewer identity.

Docker persists `/workspace` in the existing `superworkers-data` volume and `/home/worker` in
`superworkers-home`; the latter holds the browser profile, cookies, logins, dotfiles, and
user-level tools. System packages, container processes, and the writable root filesystem are
replaceable. s6-overlay is PID 1 and supervises the display, window manager, panel, browser,
and idempotent per-start setup scripts. Local, E2B, Daytona, Freestyle, and Vercel Sandbox retain the server-side headless
Playwright context at `DATA_DIR/browser-profile` and have no desktop stream. Every provider
saves throttled JPEG observations under `DATA_DIR/screens/<turn>/<n>.jpg` and emits the same
authenticated screenshot turn events.

## 7. Plugins

**Cursor plugin format** (compatible with `github.com/cursor/plugins`; validated against
`schemas/plugin.schema.json` copied into `packages/shared`):
- Install from the marketplace index (fetch `https://raw.githubusercontent.com/cursor/plugins/main/.cursor-plugin/marketplace.json`, then sparse-clone the plugin directory into `DATA_DIR/plugins/<name>`), from a git URL, or a local path.
- Load `skills/**/SKILL.md` (frontmatter `name`, `description`, `disable-model-invocation`,
  preserve unknown fields), `rules/*.mdc|md` (`alwaysApply`, `globs`), `agents/*.md`
  (exposed as delegation hints in the prompt, not executed in v1), `mcp.json` (`http` and
  `stdio`, `${VAR}` interpolation from plugin `variables`), `hooks` (parsed, stored, **not
  executed** in v1; surfaced in the UI as unsupported).
- MCP clients use `@ai-sdk/mcp` `createMCPClient`. Stdio clients are pooled by plugin/server,
  reused while healthy, and invalidated on errors, registry changes, and shutdown. HTTP/SSE
  clients close after each turn. Stdio servers run on the host with `cwd = plugin root`.

**Remote MCP OAuth**: HTTP/SSE transports receive a `PluginOAuthProvider` when a
`plugin_oauth` row or protected resource metadata exists. Discovery tries
`/.well-known/oauth-protected-resource/<server-path>` before the root form, then
OAuth authorization-server metadata (with OIDC fallback). Successful discovery,
including unprotected servers, is cached per URL for ten minutes. The resource's
advertised authorization servers and discovered issuer origin form the provider's
allowlist; unrelated authorization servers are rejected.

`plugin_oauth` has a composite `(plugin_id, server_name)` key and cascades with plugin
deletion. Client information, tokens, and code verifier use `Secrets` AES-256-GCM;
state, authorization-server information, scopes, connection approval ID, callback error,
and timestamps are persisted separately. Manual clients live in `oauth_clients`, keyed
by normalized issuer, with encrypted `client_secret`; Gmail/Drive/Calendar reuse the
same Google client. DCR registrations remain per server. Settings never returns secrets.
Client edits clear that server's grants and pending state; disconnect clears tokens and
pending state while retaining the OAuth client.

The SDK `auth()` handles PKCE S256, DCR when advertised, code exchange, and token
refresh. Providers preserve refresh tokens when a refresh response omits one. A 401
triggers one refresh and transport retry in the SDK. The generic `toolApproval` checks
connections before normal write/all policy. Missing tokens or an inactive Composio
toolkit return user approval with reason `connect:<app>` before the app action executes.
Terminal OAuth/HTTP 401/403 or Composio connection failures become a resumable connection request. Approval rows have
`kind: approval | connect` and connection JSON (source, plugin/server or toolkit, app name,
connect URL), and `resumeMode: tool | retry | connection`. Pending calls and approval responses use the existing 24-hour pause.
Not now produces a denied tool output. On reconnect the runtime opens fresh MCP clients.
Failed executions store a denied-style `connection expired` result and a `retry` approval;
after reconnect a deduplicated follow-up tells the model to retry the original action.
Command-only `connection` approvals complete without invoking the model.
Resumed optional turns bypass the reply decision. Stdio approval annotations are preserved.

The authenticated callback is `/api/plugins/oauth/callback`, based on `PUBLIC_APP_URL`
(default `http://localhost:3000`). It stays behind `requireAuth` and the owner check.
The same-origin web proxy forwards the HttpOnly SameSite=Lax cookie on top-level GET
navigation from the AS. Random state expires after ten minutes, is claimed atomically
before exchange, and is passed as `callbackState` to the SDK; the PKCE verifier is
cleared after completion or failure. Optional issuer responses are also validated.
Google has no DCR: owners configure a shared Web application client in the Connect dialog, and Google
authorization URLs add `access_type=offline&prompt=consent` for refresh tokens.

The install response includes discovered server auth (`none`, `dcr`, `manual-client`,
`unknown`), issuer, redirect URI, and connection status. Install opens the Connect dialog;
it responds to popup completion messages, with two-second polling as a fallback. The same UI is available from Settings Plugins
and `/connect/<pluginId>/<server>?approval=<id>` in a 520×720 popup. Callback errors are stored
for the dialog and translated into plain language. Verified callbacks auto-approve matching
pending connection requests and enqueue the turn once; inactive accounts cannot approve.
Composio links use `/api/connections/callback?approval=<id>` and re-fetch ACTIVE status,
retrying four times 600 ms apart because Composio redirects before the account flips to
ACTIVE. Both callbacks render a nonce-protected page posting `{ type: 'openstaff:connected',
app, approvalId }` to the same-origin opener, then close unconditionally: an identity
provider sending `Cross-Origin-Opener-Policy` nulls `opener` for good, and a popup can
still close itself. A window that survives reveals a "Return to OpenStaff" link. The parent
validates both origin and popup source; `approval.updated` also resolves cards without
navigation. Every popup-rendered failure — an unknown or spent request, a rejected Composio
key, a missing OAuth state, a verification that never went active — is a themed failure page
(`connectionFailurePopup`) with the plain-language reason, a Try again link, and a Close
button, never JSON or the app shell. Popup pages inline their own dark/light styles under a
nonce'd `style-src`. `publicOrigin` resolves the browser-visible origin from `PUBLIC_APP_URL`,
then `x-forwarded-proto`/`x-forwarded-host`, then the request URL, so a proxied deploy does
not build an `http://` postMessage target the `https://` opener would drop. Linking first
deletes the toolkit's `INITIATED`, `FAILED`, and `EXPIRED` accounts (never `ACTIVE`), so
repeated Reconnects stop accumulating accounts; saving a Composio key validates it with one
listing and clears it on rejection.

`POST /api/rooms/:id/connect { app }` resolves shared aliases, reuses a pending room
connection request, or creates a system card and a non-model approval turn. Composer
`/connect` autocomplete, render-time app chips (excluding links/code), and Members app
icons all call this endpoint. Composio cards/catalogs offer inline key onboarding via
`provider_keys`. Bot templates persist `suggestedApps`; creation posts a system-authored
welcome without planning turns. `/api/workspace/onboarding` drives the first-run checklist.

MCP servers lacking credentials and disconnected Composio toolkits are excluded from
the tool set. The Apps prompt retains their names/status, with `request_connection` as
the access path. Each run records `{ tools, hiddenApps }` in a status event.
`ConnectionHealth` checks every 30 minutes, refreshes MCP tokens expiring within one hour,
and persists `lastCheckedAt`/`refreshError`. Checks are single-flight and skip active
consent flows. Failures mark Expired; `connection.updated` invalidates live UI badges.

Marketplace defaults to Apps: Composio toolkits and MCP plugins merge through shared app
aliases. Skills contains plugins without MCP servers; hidden manifests remain hidden.
Settings Connections combines accounts, remote servers, and saved clients, with reconnect,
disconnect, and forget-client actions. The prompt's Apps section describes available apps
and their connection state and forbids claiming unconnected access. `request_connection`
can pause proactively; search results and MCP descriptions also expose connection state.
HTTP fixtures cover PKCE, state, credential secrecy, missing credentials, DCR, tool
calls, and refresh. The shared browser harness tests the cross-site callback through
the real web proxy, using temporary data directories and ephemeral ports.

**Composio**: `@composio/core`, `userId = 'workspace'`. Search and execute tools call
the core SDK directly; `request_connection` owns interactive connection pauses.
Connections are listed from Composio and mirrored atomically into `connections`.
Composio connection state is revalidated at the execution gate and callback; disconnect
deletes the connected account. Apps offers Composio sign-in and plugin installation together.

**Experimental settings**: Settings → Experimental (sidebar group *Labs*, rendered last) holds
unstable switches, currently the Jev reply-decision and browser-action experiments. Their non-secret
fields live in the `workspace.settings` JSON column under `experimental.jev` and
`experimental.jevBrowser`,
parsed by `readExperimentalSettings` in `@openstaff/shared` with defaults on anything missing or
malformed, so no migration is involved. Their shared credential is the `typesafe` provider key, encrypted in
`provider_keys` like every other key with `TYPESAFE_API_KEY` as the environment fallback; it is
excluded from `MODEL_PROVIDERS`, so it never appears on the Providers page and `PUT
/api/workspace/provider-keys` rejects it. `GET`/`PUT /api/workspace/experimental` are owner-gated for
writes and never echo the key, reporting only `keyConfigured` and `keySource`. A
`ReplyDecisionExperimentManager` and `BrowserActionExperimentManager` own the live instances: `PUT`
persists the settings and reconfigures both, swapping replacements in place so changes take effect
without a restart. Reply decisions can be observed before an optional turn, while browser-action
shadow mode observes real browser mutations without delaying or changing them. A separate bounded
browser-task comparison runs only through `apps/server/src/experiments/jev-computer-use.ts`; it is
documented in `docs/JEV_COMPUTER_USE_EXPERIMENT.md` and never runs inside a turn.

Phase 2 implementation notes:
- Plugin variables and provider keys use AES-256-GCM with a random nonce for each value.
  `SECRETS_KEY` accepts 32 bytes as hex/base64. When absent, `DATA_DIR/secrets.key` is
  generated with mode 0600 and a warning. Preserve it with database backups.
- MCP metadata comes from `MCPClient.listTools().tools[].annotations.readOnlyHint`;
  only literal `true` avoids approval under `writes`. Failed servers are skipped and
  HTTP/SSE clients close in `finally`; stdio clients remain in the workspace pool.
  Hooks are parsed but never executed.
- Composio 0.18 exposes tags, scopes, and `isNoAuth`, but no standardized operation
  read-only flag. `isNoAuth` is not permission metadata. We use the requested fallback:
  slug tokens GET, LIST, SEARCH, FETCH, READ, or FIND count as read-only; everything
  else requires approval under `writes`. This heuristic is not a security guarantee;
  use `all` when every external operation should need human review.
- Composio connection results are cached for 60 seconds. Execute uses the tool's
  discovered version, when available. Automatic file uploads are disabled.
- Local shell commands use a non-login shell and receive only PATH, workspace HOME,
  LANG, TERM=dumb, and explicit `COMPUTER_ENV_*` values. Plugin interpolation only
  uses encrypted plugin variables and explicit `PLUGIN_ENV_*` values.
- Automations use one admission pipeline for schedule, manual, and webhook triggers. Schedule
  timestamps and webhook idempotency keys deduplicate atomically; target bots are resolved and
  recorded at firing time. `skip` overlap drops only busy targets, while `queue` admits them behind
  current work. Catch-up fires at most one missed schedule after restart. Three consecutive failed
  or partially failed invocations pause the automation and notify the room; resume clears strikes.
  Webhooks use a one-time plaintext key whose SHA-256 hash is stored, accept only JSON bodies up to
  64 KiB, allow 30 authenticated requests per ten minutes per automation, and wrap payloads in an
  explicit untrusted-data envelope before admission.

## 8. Realtime protocol (`packages/shared/src/wire.ts`)

Client → server: `{ type: "subscribe", roomIds }`, `{ type: "ping" }`.
Server → client (all carry `ts`):
- `message.created` `{ message }`
- `message.delta` `{ roomId, turnId, botId, text }` (cumulative text of the pending bubble)
- `turn.updated` `{ turn }` (status changes; drives "working…" and bot status dots)
- `turn.event` `{ turnId, roomId, event }` (Activity panel)
- `approval.updated` `{ approval }`
- `room.updated` `{ room }`, `bot.updated` `{ bot }`, `task.updated` `{ task }`
- `automation.updated` `{ roomId, automation }`
- `computer.notice` `{ detail }`, `computer.storage` `{ storage }`
- `presence` `{ roomId, users: [{id, name}] }`

Reconnect: client re-subscribes and calls `GET /api/rooms/:id/messages?after=<seq>` per room
to fill gaps (townies pattern: fresh snapshot, never guess). Server never trusts client-sent
ids for authorship.

## 9. HTTP API (Hono, JSON, cookie auth)

`POST /api/auth/signup|login|logout`, `GET /api/auth/me`
`GET/POST /api/bots`, `GET/PATCH/DELETE /api/bots/:id`, `GET /api/bots/templates`
`GET/POST /api/rooms`, `GET/PATCH /api/rooms/:id`, `POST /api/rooms/:id/members`, `DELETE /api/rooms/:id/members/:kind/:id`
`GET /api/rooms/:id/messages?after&limit`, `POST /api/rooms/:id/messages` `{ text, clientRequestId }`
`GET /api/rooms/:id/turns`, `GET /api/turns/:id/events`, `POST /api/turns/:id/cancel`
`POST /api/approvals/:id` `{ decision: approve|deny, reason? }`
`GET/POST/PATCH/DELETE /api/tasks…`
`GET/POST/PATCH/DELETE /api/automations…`, manual run, key regeneration, invocation history and cancellation
`POST /api/hooks/automations/:id` (public bearer-key webhook ingress)
`GET /api/plugins`, `POST /api/plugins/install` `{ source }`, `PATCH /api/plugins/:id` (enable, variables), `DELETE`
`GET /api/plugins/:id/servers`, `PUT /api/plugins/:id/servers/:server/client` `{ clientId, clientSecret? }`
`POST /api/plugins/:id/servers/:server/connect` `{ scopes? }`, `DELETE /api/plugins/:id/servers/:server/connection`
`GET /api/plugins/oauth/callback?code&state&iss` (authenticated top-level GET, redirects to Settings)
`GET /api/marketplace/cursor`, `GET /api/marketplace/composio?q=`, `POST /api/connections/link` `{ toolkit }`, `GET /api/connections`
`GET /api/marketplace/apps?q=&cursor=&limit=24` → `{ apps, nextCursor, total, configured, warming }`
`GET /api/marketplace/skills?q=&cursor=&limit=24` → `{ skills, nextCursor, total, configured, warming }`
`GET /api/marketplace/apps/:slug` → `{ app, configured }` (in-place card refresh after actions)
`GET /api/connections/apps` remains for connected-app pickers and onboarding, not Marketplace browsing.

Marketplace limits are clamped to 1–60. Opaque base64url cursors contain `{ offset, q, version }`;
a changed query, stale catalog revision, or invalid cursor restarts at offset zero.
The server searches the merged snapshot by name, slug, aliases, and description;
ties use connection/install status, then alphabetical order. Composio builds at boot,
key changes, and every 15 minutes; the first build uses a single searched SDK page as
fallback. Cold pages have a provisional total and no next cursor until warming clears.
Refresh failures retain the last usable snapshot. Cursor plugins hydrate in the background
with a shared in-flight build and a 5-minute cache. Each build logs duration and size.

`GET /api/computer/status`, `GET /api/computer/storage`, owner-only
`POST /api/computer/storage/sync`, `GET /api/screens/:turn/:n.jpg`
`GET/PATCH /api/workspace` (default model, driver), `PUT /api/workspace/provider-keys`

## 10. Frontend (apps/web)

Three-pane layout copied from the Grok Bot desktop client:
- **Sidebar**: search, room list grouped by `section` (unsectioned rooms under
  "Unassigned"), each row = character (or stacked characters for groups), name, time,
  one-line preview; a `+` to create a bot or a group; "Marketplace" and the signed-in user
  at the bottom.
- **Thread**: header with stacked member avatars and room name, day separators, bot
  messages left-aligned with a small colored name label and grey bubble, human messages
  right-aligned black bubbles, "thinking…" and "working…" indicator bubbles while a turn is
  queued or running, approval cards (Approve/Deny), composer with `+` (attach file to
  `/workspace/uploads`) and a disabled mic. Markdown in bubbles (react-markdown + remark-gfm).
  No tool calls in the thread. An idle character companion steps below the latest completed
  bot reply; a minimal rear-view line-desk workstation replaces the avatar while a turn runs,
  with a red alert mark while waiting for approval.
- **Right panel** (toggle): tabs **Members** (list + Add Member; bot rows show status
  dot) and **Computer** (latest screenshot of the running turn, activity list from
  `turn_events`, open tasks). Settings gear opens room settings (name, section, model).
- Pages: `/login`, `/` (redirect to last room), `/rooms/$roomId`, `/bots/new` ("Meet a
  future teammate": templates + persona builder), `/bots/$botId` (edit teammate and persona),
  `/marketplace`, `/settings` (providers, computer, plugins, automations).

Styling: Tailwind v4, light theme, Inter, 14 px base, rounded-2xl bubbles, no shadows
except the composer. Bot characters are generated inline SVG from `{shape, color, eyes,
mouth, accessory, personality}`. Personality actions are finite WAAPI groups that animate
only transforms and opacity, cancel on eligibility changes, finish neutral, and remain static
under reduced motion; ambient face and breathing tracks are reduced-motion-aware CSS.

## 11. Testing

- `vitest` unit tests in `apps/server`: turn planning policy (all cases in §4.1), seq
  allocation and idempotent posting, plugin manifest loading (fixtures copied from
  `cursor/plugins`), approval resume, path jail.
- Integration test: end-to-end room flow with `MockLanguageModelV3` from `ai/test`: human
  posts in a group with two bots, one mentioned → one direct + one optional turn; the
  optional decision returns `reply:false`; assert messages, turn statuses and WebSocket
  events.
- One provider contract suite covers local, fake, Docker (opt-in), E2B (opt-in), Daytona
  (opt-in), Freestyle (opt-in), and Vercel Sandbox (opt-in), including jail, timeout, abort,
  scrubbed environment, bytes, and file operations.
  The shared suite also asserts the 16 KB output ceiling. Manager fake-clock tests cover
  idle polling, auto-resume, status caching, concurrent opens, and persisted instance reuse.
- Route tests assert credential metadata and errors never contain a canary key. Browser coverage
  exercises the Settings Computer save/test flow with a mocked provider.
- `pnpm typecheck && pnpm lint && pnpm test` must pass; `pnpm dev` boots both apps.

## 12. Sources and patterns borrowed

- `ColeMurray/background-agents` (Open-Inspect): normalized event schema, persist-before-
  dispatch, one processing turn per session, fencing, cost tracking, snapshot/restore ideas.
- `Brayden/townies`: one authoritative actor per room, serialized mutations, public vs
  private state, monotonic request ids, snapshot on reconnect, backpressure limits.
- `sw-chat` Rooms (internal): direct/optional reply modes, frozen intent policy, handoff
  depth limit, daily task allowance, capabilities bound to a server-issued claim.
- `cursor/plugins`: plugin manifest schema, SKILL.md/rules/agents/mcp.json conventions,
  marketplace index.
- Vercel AI SDK v7: `ToolLoopAgent`, `toolApproval`, `@ai-sdk/mcp`, `MockLanguageModelV3`.

## 13. Deployment

The supported production shape is one durable Linux VM running the Compose stack: server, web,
and Caddy share a named data volume. Only the gateway publishes a port. `GET /api/ready` is the
container readiness check; `GET /api/health` reports version, uptime, and non-secret Computer
state. `pnpm run doctor` reports configuration names and statuses and production boot rejects missing
encryption, HTTPS origin, model, selected-provider credentials, or Docker connectivity.
Pending migrations are a warning: startup migrates before accepting requests. Compose
sequences a dedicated migration service first; host operators should run `pnpm db:migrate`
before starting the production server.

The default Compose file has no Docker socket. `compose.docker.yml` is the explicit Docker
provider overlay and exposes only a constrained socket proxy to the server. `compose.prod.yml`
substitutes versioned GHCR images for base services and configures Caddy automatic HTTPS.
Add `compose.docker.prod.yml` after the Docker and production overlays to use the GHCR
Computer image while retaining Docker's mounts and limits. The default production stack
does not contain a Computer service. Server images include Chromium and its Linux
dependencies at `/ms-playwright`, installed before switching to the non-root user.
SQLite migrations are forward-only. Backups are online SQLite `VACUUM INTO` snapshots plus
`secrets.key`; an S3 store can retain them beside workspace objects, while Litestream continuously
replicates SQLite.

### Hosted mode

Hosted deployments set `WORKSPACE_PLAN`, `WORKSPACE_STATE`, `MANAGED_KEYS`,
`CONTROL_PLANE_TOKEN`, and optional `PUBLIC_BILLING_URL`; their defaults preserve unrestricted
self-hosted behavior. The suspended-state gate leaves health, readiness, plan, authentication,
and control-plane usage export available while returning a payment-required response for other
API and WebSocket traffic. `GET /api/usage/export` accepts only its bearer token and exports
finished turns plus overlapping Computer sessions in a half-open time window, with stable
turn pagination by finish time and ID.

## 14. Storage

Workspace persistence has two independent layers. The durable store is authoritative for the
three durable prefixes, including while no Computer exists. Attachment is how a selected Computer sees those bytes: the same host directory,
a Docker bind or volume, an E2B native volume, or server-driven synchronization for Daytona,
Freestyle, and Vercel Sandbox. Provider choice
does not select the durable store.

`WorkspaceStore` accepts only normalized workspace-relative POSIX keys. The filesystem backend
uses `DATA_DIR/workspace`. The S3-compatible backend uses one configured bucket and `S3_PREFIX`,
and supports AWS S3, Cloudflare R2, MinIO, Tigris, and compatible services. Reads consume SDK
streams; writes above 16 MB use multipart upload. Health uses `HeadBucket` and never reports
credentials or object keys.

Only `bots/`, `skills/`, and `uploads/` are durable. Their explicit server writes reach the store
first and then the active Computer. Prompts and attachment validation read the store, so a paused
or missing sandbox cannot block turn admission. Filesystem storage with a matching Local or Docker
host mount is one physical copy and skips file copying; reconciliation still refreshes its index.

For other attachments, `ComputerManager` materializes all durable objects when it opens the
Computer. After each turn it starts one background reconciliation: one inventory exec writes
size, mtime, and changed-file `sha256sum` results into a temporary report, transferred with
uncapped `readFileBytes` and then removed. Unchanged size/mtime pairs need no hashing or file
transfer. Changed or new files are uploaded, and files larger
than 20 MB are skipped with a visible warning. Store deletion is allowed only for keys this
process materialized into that Computer session. `durable_files` stores checksums, sizes, mtimes,
update timestamps, and cached skill descriptions. Prompts build the skills index entirely from
SQLite. Storage status counts SQLite rows and coalesces health checks for 15 seconds without listing objects.
The Settings Storage row and `computer.storage` report backend, bucket name, object count, and
last reconciliation time; only an owner can request an immediate sync.

S3 database backups live under the sibling `backups/` prefix. The Litestream overlay uses
`backups/litestream`. A host-mounted Archil disk instead uses the filesystem store and the
host-path overlay. See [Storage](STORAGE.md) for configuration and recovery recipes.
