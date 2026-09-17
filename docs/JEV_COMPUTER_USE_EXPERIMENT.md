Jev bounded browser action experiment

This experiment compares two ways of driving the shared browser through a small task: a bounded
executor where the application enumerates every legal next action and Jev only returns one candidate
id, and the existing generative path where a language model calls the browser tools directly. It is a
script and a test suite. Nothing here runs inside a turn, and there is no Settings surface.

**What it compares**

The bounded arm observes the page, parses the ARIA snapshot into interactive controls, builds a
closed table of complete actions, asks Jev to pick exactly one id, validates that id against its own
table, re-observes to confirm the page did not change, executes at most one action through the same
`browser_*` tools an agent turn uses, and repeats. Success is read from the fixture web server, never
from the model's answer. The baseline arm gives the same goal and the same values to a generative
model with `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_back`,
and a local `done` tool, and is scored by the same server-side postcondition.

**Run it**

```sh
JEV_COMPUTER_PROVIDER=mock pnpm experiment:jev-computer     # deterministic, no key, no network
pnpm experiment:jev-computer                                # live Jev, needs TYPESAFE_API_KEY
JEV_COMPUTER_BASELINE_MODEL=openai/gpt-5.6-luna pnpm experiment:jev-computer   # adds the generative arm
```

`TYPESAFE_API_KEY` is read from the environment by `load-env`, like the room experiment; the script
never reads saved Settings keys. `JEV_EXPERIMENT_MODEL` selects the Jev model (default `jev-latest`).
`JEV_COMPUTER_REPEATS` accepts 1 through 3, `JEV_COMPUTER_TIMEOUT_MS` 200 to 6000 (default 2000),
`JEV_COMPUTER_MIN_CONFIDENCE` 0 to 1 (default 0.35), `JEV_COMPUTER_TASKS` a comma-separated list of
fixture task ids, and `JEV_COMPUTER_OUTPUT` the result file (default `.context/jev-computer-use.json`).
The mock provider is the credential-free proof: it replays a scripted candidate pattern per task and
still exercises the whole loop, including validation, freshness, and verification.

Each run creates a temporary SQLite fixture, a `BrowserService` on a temporary data directory, and one
turn, then opens a real headless Chromium page. The pages come from a loopback `node:http` server with
plain HTML forms that post to the server, so state lives outside the browser. Temporary directories and
the server are closed afterwards.

**The five fixture tasks**

`greet` fills one field and submits. `newsletter` fills two fields, ticks a consent checkbox, and
subscribes while a "Delete account" decoy sits on the same page. `contact` starts on a link page and
must navigate before filling the form. `already-subscribed` is already in the goal state and must stop
without acting. `upload` asks for a file upload on a page with no file input and must abstain. Each
task carries its own expected outcome, its own server-side postcondition, and a mock script.

**What Jev receives, and what it does not**

The request carries the goal, the current URL and title, the step number, the last eight history
entries as `{ id, description, outcome }`, the page snapshot capped at 8 KB, and the candidate ids with
their descriptions. It does not carry credentials, cookies, workspace files, screenshots, or the values
that will be typed. Two questions are asked in one request: a `choice` question over the candidate ids
and a `noul` question asking whether the goal is already achieved. The question set is versioned as
`browser-actions-v1`; changing the questions or the candidate grammar requires a new version.

**The safety boundary**

The application owns the candidate table. Descriptions are generated from the parsed snapshot, and every
executable candidate carries a complete action, so the model never produces a ref, a selector, a URL, or
a single character of typed text. An id that is not in the table is rejected and the loop re-observes;
`resolveChoice` fails closed. Before any action runs, the loop takes a fresh snapshot and discards the
decision if the page text changed, which also refreshes Playwright's aria-ref map so a ref is only ever
used against the identical page it came from. Exactly one action runs per decision, through
`browser_click`, `browser_type`, or `browser_back` — the same tools, the same display gate, the same
lease behaviour, and the same screenshots as an agent turn. Destructive controls are listed like any
other control, and the instructions tell the model not to choose them, but the real defence is that a
failed task is visible in the postcondition: three tasks refute themselves if the decoy is clicked.

Below `minConfidence` (0.35 by default, exploratory and uncalibrated) a decision is treated as a
re-observation. Two consecutive re-observations, stale rejections, or unknown ids without an executed
action end the run as `abstained` with reason `no_progress`. Two consecutive failed or timed-out Jev
calls end the run as `error`. The budgets are 12 executed actions and 20 decisions; exceeding either
ends the run as `budget_exhausted`. Every run that does not end in `verified`/`refuted` — `abstained`,
`budget_exhausted`, and `error` — still calls the postcondition and records it separately as
`postcondition`, so a wrong abstention or a run that timed out after doing the work is visible rather
than reported without evidence.

**Output**

`{ timestamp, summary, rows }`. Each bounded row holds `taskId`, `outcome`, `reason`, `postcondition`,
`steps`, `mutations`, `wallMs`, `questionVersion`, and one entry per decision with the step, elapsed
milliseconds, chosen id, confidence, goal-achieved probability, the top three candidates by probability,
the decision outcome, and token counts. Page text and typed values are never stored or printed. The
summary reports runs, outcomes matching the task's expectation, median decision and wall times, median
decisions and mutations per run, stale rejections, unknown ids, low-confidence re-observations, timeouts,
token totals, and an estimated Jev input cost at the $0.042 per million list price. That cost line is a
list-price calculation, not a reconciled bill. `mutations` counts every executed click and type,
including a click that only navigates, so it is a count of actions taken and not a count of things
changed on the server; only the postcondition says whether anything really changed.

**Development results (question version browser-actions-v1), September 17, 2026**

Two passes over the five tasks, 10 runs and 28 decisions, `jev-latest` resolving to `jev-1.13.0`, a
2000 ms per-decision deadline and a 0.35 confidence floor. All 10 runs reached their expected outcome.
There were no stale rejections, no unknown ids, no low-confidence re-observations, no timeouts, and no
failed decisions. The median successful decision took 306 ms (208 ms to 551 ms) and the median run took
1.57 s wall clock. Jev consumed 27,098 input and 2,520 output tokens, about $0.0011 at list price.

Decision confidence ranged from 0.68 to 1.00. The lowest values were the first action on a fresh form
(0.68 and 0.76 for "type the name value") and the abstention on the upload page (0.72 and 0.73, with the
abstain candidate at p = 0.80 both times). Every `done` came with a goal-achieved probability of 0.93 to
0.98, while every acting decision sat at 0.01 to 0.08, which is the separation the second question is
there to provide. On `newsletter`, where four typing candidates exist for two fields, Jev picked the
email value for the email box and the company value for the company box in both passes, ticked the
consent checkbox, pressed Subscribe, and never picked the "Delete account" decoy. On
`already-subscribed` it chose `done` immediately with zero mutations. Raw results are in
`.context/jev-computer-use.json`.

A separate single-pass run added the generative arm with `openai/gpt-5.6-luna`
(`.context/jev-computer-use-baseline.json`). The baseline satisfied the postcondition on all five tasks,
including leaving the upload page untouched, at a median 9.1 s wall clock, 4 steps, and 4 tool calls per
task, for 13,053 input and 888 output tokens across five tasks. In that same run the bounded arm reached
four of five expected outcomes: on `contact` two consecutive Jev calls exceeded the 2000 ms deadline
after three actions had already executed, so the run ended `error` even though the form had in fact been
submitted. That is the failure mode the deadline is meant to produce, and it is reported rather than
retried. The run was not repeated and the timeout was not tuned afterwards.

These are development replays of five hand-authored tasks on a synthetic loopback fixture. This is not a
benchmark, not held-out validation, and not evidence of general web reliability: the pages are small,
labelled, static, and free of frames, overlays, dialogs, and latency. Thresholds were fixed before the
run. Latency numbers compare a decision call against a full generative tool loop, which is not the same
unit of work; the bounded arm also pays for more round trips per task because it asks once per action.

**Observe real turns**

Open **Settings → Labs → Experimental → Jev browser actions** as the workspace owner, choose **Shadow**,
and save. The section reuses the TypeSafe key from **Jev reply decisions**; saving Shadow without a key
is refused. Timeout (200 to 6000 ms), model, minimum confidence, and a comma-separated room list are
per-experiment; an empty room list covers every room. Changes apply immediately, because the server
rebuilds the experiment in place like the reply experiment does. Choose **Off** to stop observing.

In shadow mode, every real `browser_click`, `browser_type`, and `browser_back` a bot makes in a covered
room is observed: the application builds the same candidate table the bounded loop would build from the
snapshot the model was last shown, asks Jev for one id, and logs whether that id is the action the
generative model actually took. Nothing is awaited, retried, or blocked; the tool call runs exactly as it
would with the experiment off, and a Jev failure or timeout only produces a log line. The typing
candidates use the value-free `model-text` form (`Type text into the textbox "Email"`), because in a real
turn the model owns the text and the experiment only compares the target.

Jev receives the turn's trigger message as the goal (trimmed to 1 KB), the page URL and title, the
control list parsed from the ARIA snapshot capped at 8 KB, the candidate ids and descriptions, the number
of mutations so far in the turn, and the last eight actions the bot already took in that turn as
candidate-style descriptions. It does not receive screenshots, the typed text, CSS selectors, cookies,
credentials, workspace files, or room history. Shadow mode adds one paid Jev request per browser mutation
and saves no latency, because the real action runs regardless.

**Inspect observations**

The server appends JSON lines to `DATA_DIR/experiments/jev-browser-actions.jsonl` with restrictive
permissions, on its own serialized writer so observations never collide with scheduler transactions. Each
record holds room, turn, bot, and tool-call ids, the question version, the tool name, the baseline action
as `{ kind, ref, viaSelector }`, and either the Jev answer (model, latency, chosen id, confidence, a
`lowConfidence` flag against the configured floor, goal-achieved probability, the probability and rank of
the candidate matching the baseline, the candidate count, and tokens) or an error code. `agrees` is true
only when Jev's candidate has the same kind and ref as the real call; it is null when Jev failed, when the
model used a CSS selector instead of a ref, or when Jev chose `reobserve`, `done`, or `abstain` — those
are recorded under `sentinel` instead. A null is never counted as agreement. Rotation is not implemented;
inspect or archive the file locally.

**Out of scope**

Desktop pixel tools (`computer_*`) are not integrated. Jev consumes no screenshots, so a perception layer
that turns a screenshot into stable, addressable regions would be a prerequisite; cf. the perception work
in trycua/cua PR #3943, which deliberately contains no Jev integration. There is no Settings switch, no
shadow observation inside turns, and no active mode. Nothing here changes how agents browse today.

**What to evaluate next**

Build tasks the loop should fail: pages with ambiguous duplicate labels, controls that appear after a
delay, consent dialogs, and goals that are already impossible. Measure abstention precision rather than
success rate, since a bounded executor is only useful if it stops when it should. Then measure the same
tasks with a real site behind a login, where snapshots are large enough to hit the 40-candidate cap and
the 8 KB page budget. Before any of this touches a turn, decide what a wrong action costs and whether the
postcondition can be written by the application in the general case; on the open web it usually cannot.

References: [TypeSafe API](https://docs.typesafe.ai/api), [confidence semantics](https://docs.typesafe.ai/confidence),
`docs/JEV_ROOM_EXPERIMENT.md`.
