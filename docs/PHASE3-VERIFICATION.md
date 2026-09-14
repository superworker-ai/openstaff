# Phase 3 verification

Verified locally on 2026-09-12, Node v22.22.2 and pnpm 10.33.2. No commits made.

## Final checks

`pnpm install` completed successfully with the lockfile unchanged.
`pnpm typecheck`, `pnpm lint`, and `pnpm test` exited successfully.

```text
packages/shared typecheck: Done
apps/web typecheck: Done
apps/server typecheck: Done

> eslint .

 Test Files  26 passed (26)
      Tests  53 passed | 1 skipped (54)
   Start at  15:22:40
   Duration  8.90s
```

The skipped test is the opt-in real Docker test. Running the Docker test file with
`DOCKER_TESTS=1` also passed:

```text
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  15:22:49
   Duration  1.61s
```

Coverage includes free-text versus handoff mentions, attributed reply-decision context,
deduplicated missing-key notices, approval summaries, grouping, real hydrated Marketplace
tab switching, Docker demux/timeout and real exec, Chromium ARIA refs/screenshots,
browser approval pause/resume, screenshot authorization, uploads, cancellation races,
incremental compaction and throttling, and real SDK clients using a fake pooled transport.

Both production builds passed. Server bundle: 457.77 KB, build 48 ms. Web client:
2267 modules, 2.47 s. Nitro build: 4.75 s.

`docker compose config` validated successfully. The Ubuntu computer image built as
`superworkers/computer:local`, running as `worker`:

```text
sha256:050071ec28bedf6bcca337c109768e127ae4a6e94f54c5614cbc4dfb156faa8d
```

## Browser smoke

The reproducible `scripts/smoke-phase3.ts` booted the actual server with a local driver,
mock model resolver and real Chromium. The model called browser_navigate and
browser_screenshot. Observed output:

```json
{
  "server": "http://127.0.0.1:63120",
  "driver": "local",
  "turn": { "id": "turn_01M2BQFCYS1RVGXA6TD0YQTJDJ", "status": "done" },
  "screenshot": {
    "url": "/api/screens/turn_01M2BQFCYS1RVGXA6TD0YQTJDJ/2.jpg",
    "pageUrl": "http://127.0.0.1:63119/",
    "title": "OpenStaff browser smoke"
  },
  "screenshotCount": 2,
  "bytes": 11862
}
```

File verified on disk and visually inspected:
`data/phase3-smoke-YomI0g/screens/turn_01M2BQFCYS1RVGXA6TD0YQTJDJ/2.jpg`.
The smoke also verified HTTP 200 for an authorized reader, 401 without authentication,
and 404 for a user outside the room. Both servers stopped. The proof DATA_DIR remains;
disposable test directories and uniquely named Docker test containers were removed.

## Implementation choices and remaining verification limits

- Playwright 1.63's AI ARIA snapshots replace the removed accessibility snapshot API.
- Host-run Docker driver uses the requested bind mount. Compose shares the workspace
  subdirectory of its named data volume so the host Docker daemon and server container
  see the same files. Caddy keeps browser API/WebSocket traffic same-origin.
- Approval pauses retain browser pages in-process. After a server restart, persistent
  cookies survive, but old page refs may require new navigation and a fresh snapshot.
- Full Compose startup was not exercised; configuration, computer image/exec, and both
  application production builds were verified independently.
- No live provider or external MCP/Composio credentials were used. Cancellation stops
  local processes/pages; already-issued remote side effects cannot be rolled back.
- Upstream Nitro warns about the pinned Vite 7 version, and TanStack emits a circular
  dependency warning. Both builds pass. The Composio SDK declares Node 22.22.3 minimum;
  the local environment was one patch below that, as documented in README.

The emil-design-eng skill guided low-motion UI polish: stable avatar spacing, grouped
messages, unobtrusive timestamps and directly responsive tab controls.
