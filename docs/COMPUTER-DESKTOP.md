# Computer v2 — persistent desktop with live view

Status: design, 2026-09-13. Extends `ARCHITECTURE.md` §6 and lifts the v1 non-goals
"human takeover of the browser" and (partially) "arbitrary desktop apps". Research inputs:
`.context/research/desktop-vm-current-map.md` (what exists) and
`.context/research/desktop-vm-tech-survey.md` (options survey), both Codex-generated and
spot-checked.

## 1. Target: what Grok Bot's computer is (confirmed from docs.x.ai)

- One persistent Linux machine per member, a dedicated Firecracker microVM; the Bot runs
  as a non-root user. All Bots on the account share it: files, browser cookies and
  signed-in sessions, app logins, command-line credentials.
- "Each Bot gets its own screen on the shared computer, and one Bot runs one computer-use
  task on its screen at a time."
- "Open Agent Computer from a conversation to view the shared desktop. The preview shows
  clicks, typing, navigation, and current status." Humans can "open the computer, take
  control, complete only the blocked step, and tell the Bot to continue" (passwords, 2FA,
  CAPTCHAs, payments).
- Shared workspace at `/workspace`. "Treat temporary directories, manually installed
  packages, and uncommitted application state as replaceable." Admin "Kill" deletes the
  running VM but keeps durable storage. Deleting a Bot does not remove files or logins.
- Not disclosed: distro, display stack, streaming codec/transport.

So the durable unit is *storage* (home + workspace + browser profile), and the machine is
disposable compute around it. That is the model we copy.

## 2. Where we are (gaps)

Today "Computer" is two systems wearing one label: an Ubuntu container that only runs
`shell`, and a headless Playwright Chromium *inside the server process* whose JPEG
screenshots (≤1 per 2 s per turn) become `turn_events`. Consequences:

- Nothing is streamed; the panel shows the last JPEG of one turn.
- Browser state lives in the server's `DATA_DIR/browser-profile`, so the browser and the
  shell run on different machines with different networks and filesystems.
- Only `/workspace` persists. The computer container's `HOME` is `/workspace` (accidental
  sharing of dotfiles with work files); the root FS is a writable container layer that is
  lost on recreate.
- No human takeover; no terminal view; no control arbitration between bots.
- Bug: in Compose, `DockerComputer.ensureContainer` binds `/data/workspace` (a path inside
  the server container) when it has to recreate the computer, which is meaningless on the
  Docker host. `COMPUTER_WORKSPACE_VOLUME` is only checked, never used for creation.

## 3. Decisions

### D1. Substrate: one hardened Docker desktop container per workspace (not a microVM)

Docker Compose is already the deployment. A desktop container needs no KVM, runs on any
VPS, and keeps the existing `/workspace` bind that all file tools depend on. Firecracker or
E2B become later drivers behind the same interface. Product copy says "computer", not "VM".

### D2. Display + stream: KasmVNC over a single WebSocket, proxied by Hono

KasmVNC's `Xvnc` *is* the X server (no Xvfb), serves its own web client and WebSocket on
one port, uses webp/jpeg with dynamic quality, and enforces read-only vs write per VNC
user server-side (`kasmvncpasswd -r` / `-w`). GPL-2.0, but it runs as a separate process
in the image; nothing links against it. This is the same stack as linuxserver/webtop.

Rejected for v1: **Neko** (WebRTC, best latency and a native "request control" model, but
needs a second exposed UDP/TCP port plus TURN for NAT'd deployers; keep as an optional
`stream: neko` driver later), **Selkies 2.0** (release candidate), **noVNC + TigerVNC**
(fallback if KasmVNC packaging fights us; no server-side view-only without a second VNC
server password scheme), **Sandbox Agent** (bundles Neko + a Rust daemon; more moving parts
than we need).

### D3. Browser: one headed Chromium *inside* the desktop, driven over CDP

The desktop supervisor starts one long-lived Chromium on the desktop display with a
dedicated profile `/home/worker/.config/superworkers/chrome` (Chrome ≥136 refuses remote
debugging on the default profile) and a loopback CDP socket forwarded to container port
9222. The server attaches with `chromium.connectOverCDP(...)`, uses
`browser.contexts()[0]` (the persistent default context), and opens one *tab* per turn
exactly as today. Humans watching the stream see the same tabs the bot drives; cookies and
logins are shared by construction, matching Grok.

Rules: the server never calls `browser.close()`; on CDP disconnect it reconnects and
re-adopts tabs by target id; `page.screenshot` continues to feed model observations and
`turn_events` (the human video stream is not the model's eyes). `--password-store=basic`
in v1 so cookies stay decryptable across restarts without a keyring; documented as
"secrets are protected by the volume, not by Chrome".

The `local` driver keeps today's in-process headless Playwright (dev only, no stream).

### D4. Persistence layout

| State | Location | Volume | Survives recreate/upgrade |
|---|---|---|---|
| Work files, bot memory, skills, uploads | `/workspace` | `superworkers-data` (existing, subpath `workspace`) | yes |
| Browser profile, cookies, logins, dotfiles, `~/.local`, shell history, user-level tools | `/home/worker` (`HOME` fixed to this) | `superworkers-home` (new) | yes |
| System packages, root FS | image layer | none | no; rebuild via `docker/computer/setup.d/*.sh` |
| tmux sessions, running processes | container | none | survive server restarts, not container restarts |

The server's SQLite stays in `DATA_DIR`. Reset actions: reset browser profile, reset home
(keep workspace), recreate container (keep both volumes). Never `docker commit`.

### D5. Stream auth: same-origin proxy, mode decided by the server

`GET /api/computer/desktop/*` and its WebSocket upgrade are proxied by Hono to the desktop
container's KasmVNC port on a private Compose network. Hono checks the session cookie and
`Origin`, then injects HTTP basic auth for either the `viewer` (read-only) or `controller`
(write) VNC user depending on the control lease (D6). KasmVNC credentials never reach the
browser; the container port is never published. The panel embeds the proxied client in a
sandboxed `<iframe>`; the wrapper owns loading, reconnect, fullscreen and the takeover
controls.

### D6. Control lease (takeover)

A single `computer_lease` row per workspace: `{ owner: 'bot'|'human', ownerId, epoch,
acquiredAt, expiresAt, heartbeatAt, reason }`. States: `agent_control → human_requested →
human_control → returning → agent_control`. Taking over increments the epoch, pauses bot
input (browser tools check the epoch before every action and fail fast when stale), and
re-proxies the human's stream as `controller`. Returning control releases stuck keys,
takes a fresh screenshot, records a `status` turn event ("human returned control"), and the
bot resumes from a new observation. Approval cards gain a "Take over" action for the
CAPTCHA/2FA case, exactly Grok's flow.

### D7. Screens and concurrency

v1 has one screen. Browser actions from concurrent turns are serialized per workspace by a
short display mutex around each action (bring tab to front → act → screenshot). Shell and
file tools are unaffected. "Each Bot gets its own screen" is deferred: it needs either
multiple Xvnc displays (breaks the one-Chromium-per-profile rule) or per-bot Chromium
windows placed on a larger virtual screen. Tracked as an open question.

### D8. Terminal (phase 3)

`@xterm/xterm` in the panel, WebSocket `/api/computer/terminal`, backend `docker exec -it`
into a per-workspace `tmux` session (`sw-main`). Survives page reloads and server
restarts; the UI says plainly when the container restarted and processes ended.

## 4. Architecture

```
browser (React)                        server (Hono)                       desktop container
┌──────────────────────┐   cookie/WS   ┌──────────────────────────┐  compose net  ┌─────────────────────────┐
│ ComputerPanel        │──────────────▶│ /api/computer/desktop/*  │─────────────▶│ KasmVNC :6901 (Xvnc :1) │
│  ├ <iframe> Kasm     │               │   proxy + lease → user   │              │  openbox, tint2         │
│  ├ Take over/Return  │──────────────▶│ /api/computer/lease      │              │  chromium --user-data-dir│
│  ├ activity, tasks   │◀── turn.event │ BrowserService (CDP)     │─────────────▶│    --remote-debugging   │
│  └ terminal (P3)     │──────────────▶│ /api/computer/terminal   │──docker exec▶│  tmux, worker uid 1000  │
└──────────────────────┘               │ Computer (docker exec)   │──docker exec▶│  s6-overlay supervisor  │
                                       └──────────────────────────┘              └───────┬─────────┬───────┘
                                                 DATA_DIR/workspace ═══ bind ═══ /workspace  /home/worker
                                                                                  (superworkers-data)  (superworkers-home)
```

Container services (s6-overlay, in order): dirs/permissions → Xvnc (KasmVNC, `:1`,
1280×800×24) → openbox → tint2 → chromium → health file. Readiness = X responds, WM owns
root window, `GET http://127.0.0.1:9222/json/version` OK, KasmVNC websocket answers.

Compose changes: new `computer-net` (internal) joined by `server` and `computer`; new
`superworkers-home` volume; `shm_size: 1g`; `mem_limit: 4g`; `pids_limit`; no published
ports on `computer`; `cap_drop: [ALL]` stays; Chromium runs with its own sandbox (needs
user namespaces, Playwright's seccomp profile) — `--no-sandbox` is not the default.
`DockerComputer` creates missing containers with the named volumes, not host paths.
Outside Compose, the driver publishes CDP and VNC on ephemeral loopback ports and discovers
their assigned endpoints from the container inspection result.

Config: `COMPUTER_DESKTOP_URL` (default `http://superworkers-computer:6901`),
`COMPUTER_CDP_URL` (default `http://superworkers-computer:9222`), `COMPUTER_VIEWER_PASSWORD`
/ `COMPUTER_CONTROLLER_PASSWORD` (generated into `DATA_DIR/secrets` on first boot and
written into the container's `~/.kasmpasswd` on start), `COMPUTER_SCREEN=1280x800`.

API additions: `GET /api/computer/status` gains `{ desktop: boolean, cdp: boolean,
lease }`; `GET|WS /api/computer/desktop/*`; `POST /api/computer/lease` `{ action:
'take'|'return' }`; `POST /api/computer/reset` `{ scope: 'browser'|'home'|'container' }`;
(P3) `WS /api/computer/terminal`.

## 5. Phases

**Phase A — persistent desktop + live view (this is the "goes further" ask).**
Image (Ubuntu 24.04 + KasmVNC + openbox + tint2 + Chromium + s6-overlay), volumes and
`HOME` fix, Compose wiring, `DockerComputer` creation fix, `BrowserService` CDP mode with
tab adoption, Hono desktop proxy (HTTP + WS), panel iframe with view-only stream and
"live/offline" state, status fields, README. Acceptance: login in the bot's browser
survives server restart, container restart and image rebuild; human sees the bot clicking
live within ~250 ms on LAN; CDP and VNC ports unreachable from outside; Chrome runs
non-root with sandbox on; existing browser/computer tests green plus new CDP-mode tests.

**Phase B — takeover. ✅ Complete.** Lease table + API + epoch checks in browser tools + panel
controls + "Take over" on approval cards + audit events. Acceptance: stale bot actions fail
during takeover; returning control forces re-observation; preview connections can never
send input.

**Phase C — computer use. ✅ Complete.** Full-display JPEG observations and native mouse,
keyboard, scroll, drag, wait, window-list, and window-focus tools, sharing the browser's
display mutex, takeover lease gate, event stream, and per-turn screenshot sequence.

**Phase D — terminal + resets.** xterm.js/tmux terminal, reset actions, retention for
`DATA_DIR/screens`, setup-script re-application on image upgrade.

**Hosted driver.** `computer: e2b` uses `@e2b/desktop` to provide the same panel, lease,
events, CDP browser, and computer-use tools from a hosted Firecracker microVM. See “Hosted
drivers” below.

**Later / optional drivers.** `stream: neko` (WebRTC, lower latency, needs UDP+TURN);
gVisor runtime flag; multi-screen; GNOME keyring instead of `password-store=basic`.

## 6. Computer use

The Docker provider exposes native `captureScreen` and `desktopInput` operations. Its small
POSIX wrappers call scrot and xdotool on display `:1`; typed text crosses the Docker API only as
base64 argv and is decoded into xdotool's stdin. The model receives `computer_screenshot`, pixel
click/double-click/right-click/move/drag, type, key, scroll, wait, window-list, and window-focus
tools. Structured `browser_*` tools remain preferred when Chromium has a useful accessibility
snapshot because they use fewer tokens and are less sensitive to layout changes.

Browser and desktop actions use one workspace display mutex and the same fenced takeover lease.
If a human holds control, a bot action records paused/resumed status and takes a fresh observation
after control returns. Browser and desktop captures also share one `ScreenRecorder`, so JPEGs
interleave safely under `DATA_DIR/screens/<turnId>/<n>.jpg`. Events contain only the authenticated
URL and metadata (`source: desktop`, width, height), never image base64. Inline image parts are
removed before resumable model messages are persisted.
Before each model step and on approval resume, context retains images from only the latest `COMPUTER_SCREENSHOT_CONTEXT` image-bearing tool results (default 3), replacing older images with screenshot URL text.

Desktop observations are JPEG quality 60 at the native 1280×800 resolution so shown coordinates
map 1:1 to input. Action screenshots are limited to one per 700 ms per turn; explicit screenshots
bypass that limit. Computer vision therefore costs substantially more input tokens than an ARIA
snapshot and should be reserved for native apps, canvases, dialogs, and browser fallback.

## Hosted drivers

The E2B provider is a full desktop Computer by default. It creates the
`E2B_DESKTOP_TEMPLATE` template, default `desktop`, at 1280×800 and runs one headed Chromium
with its profile at `/home/user/.config/openstaff/chrome`. A small proxy inside the sandbox
exposes Chrome CDP through E2B while keeping Chrome itself loopback-only. Set `E2B_DESKTOP=0`
to retain the legacy shell-only provider, which uses `E2B_TEMPLATE` or `base`.
If a custom desktop template contains neither Chrome nor Chromium, the provider installs Chromium
with `apt` on first open and reports the added package-download startup cost in status.

E2B pause and resume preserve the microVM filesystem and memory indefinitely, while the named
volume mounted at `/workspace` remains the durable workspace attachment. Pause and resume also
reset E2B's continuous-runtime clock. Current plan limits are 1 hour on Hobby and 24 hours on
Pro, and default desktop compute costs approximately $0.17 per running hour.

E2B streams are external authenticated URLs rather than same-origin proxied VNC. The server
issues a view-only URL unless the requesting user holds the takeover lease. E2B does not expose
fine-grained credential revocation, so returning or expiring control stops and restarts the
stream to rotate its auth key. That coarse revocation invalidates viewers too; the panel fetches
a new session URL on every lease epoch and reconnects.

## 7. Open questions

1. Multi-screen per bot (D7). Candidate: one 2560×1600 virtual screen, one Chromium
   *window* per active bot, stream crops per bot. Needs a prototype.
2. Does KasmVNC's client tolerate our path-prefixed proxy without its own `SUBFOLDER`
   handling? Verify in Phase A before building the panel; fall back to proxying at `/`
   on a dedicated subdomain if not.
3. Chromium sandbox inside `cap_drop: ALL`: resolved in Phase A. The SUID sandbox is defeated by
   `no-new-privileges` and the user-namespace sandbox failed its `sys_chroot` check on Docker
   Desktop arm64, so `run-chromium` probes the sandbox at every start and falls back to
   `--no-sandbox` with a logged warning; `COMPUTER_CHROME_NO_SANDBOX=0` requires it, `1` skips
   the probe. Re-test on a Linux host with the default runtime and record the result.
4. `local` driver parity: keep headless Playwright, or run the same desktop image on Docker
   Desktop for dev? Recommendation: keep headless for dev speed.

## 8. Sources

- docs.x.ai/grok-bot: overview, computer-and-apps, faq, teams-and-enterprises
- KasmVNC: github.com/kasmtech/KasmVNC (GPL-2.0; `-r`/`-w` users; webp; single port)
- Neko: neko.m1k1o.net/docs/v3/configuration/webrtc (udpmux/tcpmux, TURN)
- Chrome 136 remote debugging: developer.chrome.com/blog/remote-debugging-port
- Playwright `connectOverCDP`, persistent context and Docker sandbox notes: playwright.dev
- Full survey with 30+ more citations: `.context/research/desktop-vm-tech-survey.md`
