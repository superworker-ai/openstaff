# Evaluating bot behaviour changes

How to tell whether a prompt, tool, or routing change made bots better, using what the
repo already has. Written after the 2026-09-22 change that trimmed the Apps section,
added the "connected apps come first" rule, and gave `composio_search` a toolkit filter,
input schemas, and empty-result notes. The same recipe applies to any change that alters
which tools a bot picks or how many calls it needs.

There are three tiers. Run them in order; each one is cheaper than the next and catches a
different class of regression.

| Tier | What it checks | Cost | Where |
| --- | --- | --- | --- |
| 0. Deterministic | The prompt and tool set the model receives | seconds, no model | vitest with `MockLanguageModelV3` |
| 1. Scenario harness | What a real model does on fixed tasks | minutes, a few cents | tsx script, loopback fixtures |
| 2. Production telemetry | What bots do for real users | free, needs traffic | SQL over `turn_events` and `turns` |

Rules that apply to every tier, carried over from the Jev experiments
(`docs/JEV_ROOM_EXPERIMENT.md`, `docs/JEV_COMPUTER_USE_EXPERIMENT.md`):

- Fix the scenarios, labels, and thresholds before the run. Never tune them to fit results.
- Success is read from an independent source (the fixture server, the database, the tool
  call log), never from the model's own text.
- Compare paired arms on the same scenarios. A single arm proves nothing.
- Keep the output JSON in `.context/` and summarise medians, not means; note timeouts and
  errors separately from wrong answers.

## Tier 0: deterministic checks

These run today and cost nothing. They verify the contract without a model: which tools are
registered, what the Apps section says, where the timestamp sits.

```bash
pnpm exec vitest run apps/server/src/agent/connection-tools.test.ts apps/server/src/agent/history.test.ts apps/server/src/composio/composio.test.ts
```

Pattern for a new assertion (from `apps/server/src/agent/connection-tools.test.ts`): build an
`AgentRuntime` with a `MockLanguageModelV3`, run one turn, and inspect
`model.doStreamCalls[0].tools` for the tool list and `model.doStreamCalls[0].prompt` for the
instructions. `ComposioService` accepts a fake client, so connected apps are whatever the
test says they are.

Good Tier 0 assertions for routing changes:

- The Apps section names only connected, lapsed, and suggested apps. Assert an unrelated
  catalog toolkit is absent.
- The Computer section contains the routing rule text.
- `composio_search` and `composio_execute` are registered only when an account is ACTIVE for
  the actor.
- `composio_search` returns `note` on empty results and `inputParameters` when the client
  provides them.

## Tier 1: scenario harness with a real model

This is the tier to build for prompt and tool-description changes. The bot runs a real
model through the real `AgentRuntime` against fake services, and the harness scores the
tool calls it made. The pieces already exist:

- `apps/server/src/test/fixture.ts` creates an isolated database, workspace, room, bot, and
  admission service.
- `apps/server/src/experiments/browser-fixture.ts` serves a loopback HTML site with a
  `/state` endpoint for independent verification.
- `ComposioService` takes a fake `ComposioClient`, so `search` and `execute` can return
  canned Linear or Gmail tools and record what was called.
- `resolveModel` in `apps/server/src/agent/models.ts` gives a real provider model from the
  keys in `.env`.
- `apps/server/src/experiments/jev-computer-use.ts` shows the shape: env-driven config,
  fail-fast validation, repeats, paired arms, JSON output under `.context/`.

### Scenario set

Author scenarios as data, one object each, with the label fixed before the run. Start with
these twelve; they cover the browser-versus-integration decision from both sides.

| id | Connected apps | Trigger message | Expected first tool | Expected outcome |
| --- | --- | --- | --- | --- |
| linear-list | linear | "list my open Linear issues" | `composio_search` | `composio_execute` with a LIST or SEARCH slug |
| linear-detail | linear | "what is SUP-3227 about?" | `composio_search` | execute `LINEAR_GET_LINEAR_ISSUE` with `issue_id` |
| linear-not-connected | none | "list my open Linear issues" | `request_connection` | no browser navigation to linear.app |
| gmail-send-writes | gmail | "email Sam that the deck is ready" | `composio_search` | execute a SEND slug, approval requested under `writes` |
| gmail-unconnected-member | gmail (workspace only, actor is a member) | "check my inbox" | `composio_search` | executes with the workspace account, prompt says "workspace" |
| public-site | linear | "what does the pricing page on the fixture site say?" | `browser_navigate` | no Composio call |
| form-fill | none | "subscribe test@example.com on the fixture newsletter page" | `browser_navigate` | fixture `/state` shows the email |
| connected-but-visual | linear | "screenshot the Linear roadmap board" | `browser_navigate` or `computer_screenshot` | at most one `composio_search` |
| vague-query | linear | "anything new in Linear?" | `composio_search` | at most two searches before execute |
| toolkit-filter | linear, gmail | "find the Linear issue about invoices" | `composio_search` with `toolkit: "linear"` | one search, one execute |
| empty-search | linear | "archive the Linear project called Nope" | `composio_search` | after a `note` result, no repeated identical query |
| shell-only | linear | "count the lines in notes.md in the workspace" | `shell` or `read_file` | no Composio, no browser |

The fake Composio client returns a fixed catalog of eight Linear tools and four Gmail tools
with real `inputParameters` copied once from Composio, and answers `search` by keyword
overlap on slug and description. That keeps the harness offline and makes empty results
reproducible: `archive the Linear project` should match nothing because the catalog has no
project-archive tool.

### Metrics

Score each run from the recorded tool calls, never from the reply text.

| Metric | Source | Why it matters |
| --- | --- | --- |
| first tool matches label | first `tool-call` event | the routing decision itself |
| outcome matches label | tool calls plus fixture `/state` | the task got done |
| searches per execute | count of `composio_search` before the first `composio_execute` | search legibility |
| repeated identical queries | duplicate `query` strings within a turn | whether empty-result notes are read |
| wrong-surface calls | browser calls in integration scenarios and vice versa | wasted work |
| steps, wall time, input tokens | `turns.usage` and timestamps | cost of the change |

Pass criteria for promoting a prompt change: first-tool accuracy at or above the previous
arm on every scenario, searches per execute not worse, no new wrong-surface calls, and
input tokens per turn lower or equal.

### Arms and repeats

Run two arms on the same scenarios in the same session: the current prompt and the previous
one. The cheapest way to get the previous arm is a `PROMPT_VARIANT` env read inside
`buildTurnPrompt` and `AgentConnections.prompt` that swaps the changed sentences back; keep
the variant table in the experiment script, not in production code paths. Three repeats per
scenario is enough to see whether a difference is noise; `gpt-5.6-sol` is not deterministic.

### Wiring sketch

```
pnpm experiment:routing            # PROMPT_VARIANT=current, ROUTING_MODEL from DEFAULT_MODEL
PROMPT_VARIANT=previous pnpm experiment:routing
```

The script, `apps/server/src/experiments/routing-evals.ts`, should:

1. Validate env (`ROUTING_MODEL`, `ROUTING_REPEATS` 1 to 3, `ROUTING_SCENARIOS` filter) and
   resolve the model before starting anything, like the Jev script does.
2. Start the browser fixture and a `fixture()` database.
3. For each scenario, seed the fake Composio connections for the scenario's apps and post the
   trigger through `admission.post` so a real turn is created.
4. Run the turn through `AgentRuntime` with a real `BrowserService` and the fake
   `ComposioService`, with the approval policy the scenario names.
5. Read `turn_events` for that turn, score the metrics, and append a row.
6. Write `.context/routing-evals-<variant>.json` with per-row results and a summary of medians.

Approval requests end the turn as `waiting`; count that as the expected outcome for the
`writes` scenarios rather than resolving the approval.

## Tier 2: production telemetry

Every turn already records tool calls and usage, so the deployed change can be measured
against the weeks before it without any new code. The queries below run on the local
`data/openstaff.db` with `sqlite3`. On Railway there is no `sqlite3` binary; run the same SQL
through Node's built-in `node:sqlite` over `railway ssh -s server` using the base64 `node -e`
trick recorded in `docs/DEPLOY.md`. Always read the live database read-only or query a
`VACUUM INTO` backup.

Tool sequence per turn, newest first. This is the fastest way to see routing by eye:

```sql
select substr(turn_id, -6) turn,
       group_concat(json_extract(payload, '$.toolName'), ' > ') seq
from (select turn_id, payload, created_at from turn_events where type = 'tool-call' order by seq)
group by turn_id
having seq like '%composio%' or seq like '%browser_%'
order by max(created_at) desc
limit 30;
```

Search efficiency. Before the 2026-09-22 deploy the local database showed 39 empty results
out of 67 searches and 35 executes, so roughly two searches per execute with more than half
returning nothing. That is the baseline to beat.

```sql
select sum(type = 'tool-call' and json_extract(payload, '$.toolName') = 'composio_search') searches,
       sum(type = 'tool-result' and json_extract(payload, '$.toolName') = 'composio_search'
           and (payload like '%"output":[]%' or payload like '%"tools":[]%')) empty_searches,
       sum(type = 'tool-call' and json_extract(payload, '$.toolName') = 'composio_execute') executes
from turn_events
where created_at >= '2026-09-22';
```

First tool per turn, which is the routing decision in aggregate:

```sql
select first_tool, count(*) n
from (select turn_id, json_extract(payload, '$.toolName') first_tool, min(seq)
      from turn_events where type = 'tool-call' group by turn_id)
group by first_tool
order by n desc;
```

Prompt cost and cache hit rate per day. Input tokens should drop after the Apps section
change, and cache reads should rise after the timestamp moved to the end:

```sql
select substr(started_at, 1, 10) day, count(*) turns,
       cast(avg(json_extract(usage, '$.inputTokens')) as int) avg_input,
       cast(avg(json_extract(usage, '$.inputTokenDetails.cacheReadTokens')) as int) avg_cache_read
from turns
where usage is not null and usage != ''
group by day
order by day desc
limit 14;
```

Wrong-surface signal: turns that opened a connected app's website in the browser. Adjust the
domain list to the apps connected in that workspace.

```sql
select substr(turn_id, -6) turn, json_extract(payload, '$.input.url') url, created_at
from turn_events
where type = 'tool-call' and json_extract(payload, '$.toolName') = 'browser_navigate'
  and (json_extract(payload, '$.input.url') like '%linear.app%'
       or json_extract(payload, '$.input.url') like '%mail.google.com%')
order by created_at desc;
```

Read the two weeks before and after a deploy side by side. Traffic is small, so report counts
and medians, and say when a day has fewer than ten turns.

## Manual spot check after a deploy

For a change like the routing rule, one guided turn is worth doing before waiting for
telemetry:

1. In a room where Linear is connected, ask the bot to list your open issues.
2. Open the turn's activity: the first tool call should be `composio_search`, the result
   should carry `inputParameters` and `connectedApps`, and `composio_execute` should follow
   within two searches.
3. Ask for something Linear cannot do through its API, such as a screenshot of a board, and
   confirm the bot goes to the browser without looping on search.
4. Ask about an app that is not connected and confirm `request_connection` fires instead of
   a browser login attempt.

Record what you saw in `.context/` with the turn IDs so the telemetry queries can be checked
against a known-good example later.
