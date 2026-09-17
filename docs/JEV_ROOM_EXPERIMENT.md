Jev room reply experiment

This experiment compares Jev with the existing model that decides whether an optional bot should contribute to a group room. It is disabled by default. Shadow mode always returns the existing model's decision and never waits for Jev to finish.

**Run the synthetic comparison**

Supply `TYPESAFE_API_KEY` through your shell or local ignored environment file. The baseline needs its normal provider key. Run:

```sh
pnpm experiment:jev-rooms
```

The script uses `JEV_BASELINE_MODEL`, falling back to `REPLY_DECISION_MODEL` and then `DEFAULT_MODEL`. It reads provider credentials from the environment, not saved Settings keys. Each case creates an isolated temporary SQLite room, inserts scripted teammate messages, and calls the actual `AgentRuntime.decideReply` implementation against both live APIs. It does not start the agent tool loop, post to real rooms, or execute external actions. Temporary rooms are removed afterward.

Twenty-six scenarios cover job relevance, repeated answers, partial answers, corrections, closing thanks, a new request following thanks, Spanish conversations, explicit blockers, instruction injection, name addressing, nicknames, misspellings, and ambiguous requests. Expected answers are hand-authored diagnostic labels, not a validated benchmark. Repeating cases measures stability, not additional independent evidence.

`JEV_EXPERIMENT_REPEATS` accepts 1 through 3. `JEV_EXPERIMENT_OUTPUT` selects the output file; the default is `.context/jev-room-replies.json`. `JEV_EXPERIMENT_MODEL` and `JEV_EXPERIMENT_TIMEOUT_MS` set the Jev model and deadline for the script only; the server reads neither. The script reports successes, deferred recommendations, errors, median latency, token use, baseline agreement, and agreement with the scenario labels. Requests are paid, run sequentially per case, and use the same six-second baseline deadline as the room runtime. The two provider calls for each case run concurrently. The first request may include connection setup.

**Observe a room**

Open **Settings → Experimental → Jev reply decisions** as the workspace owner. Paste a TypeSafe API key, choose **Shadow**, optionally set the timeout in milliseconds, the Jev model, and a comma-separated list of room IDs, then save. The key is encrypted with the other provider keys and is never returned by the API. Changes apply immediately: the server rebuilds the experiment in place, so no restart is needed. Choose **Off** to stop observations.

An empty room list includes all rooms when shadow mode is enabled. Saving a key alone does not enable the experiment, and saving Shadow without any key is refused. There is deliberately no active mode in this first experiment.

`TYPESAFE_API_KEY` in the server environment still works as a fallback for the key only; a saved key takes precedence, and the section shows which source is in use. `JEV_REPLY_MODE`, `JEV_MODEL`, `JEV_REPLY_TIMEOUT_MS`, and `JEV_REPLY_ROOM_IDS` are no longer read by the server. A leftover `JEV_REPLY_MODE` logs one warning at startup and is otherwise ignored.

Only optional replies that reach the existing decision call are observed. A human using a bot's name or slug as a standalone word now creates a direct turn, just like an explicit at-name mention, so those turns bypass the reply decision. Direct messages, explicit bot handoffs, system automation turns, and the scheduler's final-responder fallback also bypass it. Ordinary bot messages do not create new bot turns, and explicit handoffs still stop at the existing depth limit. Later optional bots continue to see earlier replies to the same trigger. This experiment does not introduce autonomous conversation loops.

The native TypeSafe endpoint receives the candidate's name and job, the other bots as one `Name: job` line each in `teammates`, the triggering message with its author kind, the existing bounded room history, and recent replies. The explicit trigger prevents later teammate replies from being mistaken for the request being evaluated, while the teammate roster lets the evaluator distinguish a nickname aimed at the candidate from one aimed at somebody else. It does not receive tools, screenshots, or workspace files. Jev is a separate decision service, not a chat provider. The existing reply-model setting still controls the baseline and conversation compaction.

**Inspect observations**

The server appends JSON lines to `DATA_DIR/experiments/jev-replies.jsonl` with restrictive permissions. Each record contains room, turn, and bot IDs, question version, concrete Jev model, both provider timings and token usage, Jev probabilities, an exploratory recommendation, and agreement with the baseline. Room content, the baseline's free-text reason, and credentials are excluded. Inspect or archive this experimental log locally; rotation is not implemented.

Telemetry uses a separate file rather than the shared SQLite connection, so observer writes cannot collide with scheduler transactions. Writes are serialized, and failures do not change a reply. In-flight requests are aborted and observation tasks are drained on server shutdown. Timed-out or failed Jev calls do not change baseline behavior; failed baseline calls retain the current scheduler behavior.

Jev answers five independent yes/no questions. The first asks whether the trigger addresses the candidate by name, misspelling, nickname, or an explicit request to respond; the remaining questions cover relevance, whether work is requested, whether the contribution is already covered, and whether an explicit new correction or blocker is present. Their probabilities are combined by `recommendReply` into reply, skip, or defer. These deliberately conservative thresholds are exploratory and are not calibrated. A deferred recommendation has no agreement score and must not be counted as a correct classification. Question and rule changes require a new `REPLY_QUESTION_VERSION` and a new held-out evaluation.

On September 17, 2026, this change was prompted by a real group-room failure: a human greeted Ferruccio by name three times without an at sign, including one misspelling, but the parser created only optional turns and the lane-based decision skipped him. The final-responder fallback then made Zach act, adding an unnecessary handoff before Ferruccio answered. Deterministic human name addressing fixes the turn plan; the `addressed` question and `teammates` state cover optional decisions involving nicknames or another named bot.

**Development results (question version v2), September 17, 2026**

Two input versions were compared with `openai/gpt-5.6-luna`, the configured reply model. Each version evaluated the same sixteen scenarios twice, giving 32 paired calls per version. Four trials per version had intentionally ambiguous labels and were excluded from correctness counts. Jev resolved to `jev-1.13.0`.

* Version 1 supplied named history and recent replies without a distinct trigger. Jev completed 31 of 32 calls, with one 1.2-second timeout; the baseline also completed 31, with one error. Successful-call medians were 276 ms for Jev and 2,106 ms for the baseline. The conservative rule accepted eight of 28 labeled trials; all eight matched the intended label. The baseline matched 26 of 28, with one wrong answer and one failed call.
* Version 2 added the triggering message and author kind explicitly and instructed each question to evaluate that trigger. Both providers completed all 32 calls. Successful-call medians were 251 ms for Jev and 2,515 ms for the baseline. The unchanged combination rule accepted fourteen of 28 labeled trials; all fourteen matched the intended label. Jev deferred the remaining fourteen labeled trials and all four ambiguous trials. The baseline matched 27 of 28 labeled trials.

The explicit trigger improved the security-blocker example: relevance increased from roughly 0.46 to 0.96 and actionability from roughly 0.28 to 0.97. This supports retaining the structured trigger instead of expecting the model to infer participant roles from names. It does not prove those scores are calibrated.

These are development replays of the same small hand-authored cases, not held-out validation or evidence of general reliability. Version 2 was designed after inspecting version 1. Thresholds stayed fixed. The raw local results are `.context/jev-room-replies-v1.json` and `.context/jev-room-replies.json`. Version 2 reported 23,624 Jev input tokens; no provider bill was reconciled. Latency comparisons cover provider calls, not complete room turns, and shadow mode still pays for and waits on the baseline.

The next experiment should use new labeled room examples to measure how much useful work can safely avoid the baseline. The observed fifty-percent acceptance on labeled version 2 trials is promising, but insufficient to enable automatic routing. The baseline also varied on a request beginning with thanks but containing new work, reinforcing the need for human-reviewed labels instead of baseline agreement alone.

**Development results (question version v3), September 17, 2026**

Version 3 evaluated 26 scenarios twice, giving 52 paired requests. Six trials had intentionally ambiguous labels, leaving 46 labeled trials. Jev completed 48 requests with a 313 ms successful-call median; the baseline completed 50 with a 1,943 ms median. The fixed Jev rule accepted 22 labeled trials and all 22 matched their labels. The baseline matched 39 of 46 labeled trials. Four Jev timeouts and two baseline failures count as unsuccessful calls and not as correct classifications.

Across the ten new addressing scenarios, the baseline matched all 18 labeled trials and returned skip for both deliberately ambiguous `talk-among-yourselves-zach` trials. Jev made 15 decisive recommendations and all 15 matched their labels, deferred twice for `nickname-task-zach` and twice for the ambiguous scenario, and timed out once for `greeting-other-bot`. Successful `addressed` probabilities were 0.94 through 0.98 when the candidate was named, misspelled, or nicknamed, and 0.05 through 0.07 when only the other bot was named. The raw results are `.context/jev-room-replies-v3.json`.

**What to evaluate next**

Measure missed useful contributions, redundant responses, acceptance coverage, timeouts, and latency on reviewed room examples. Keep deterministic targeting and handoff limits. Before enabling Jev to affect replies, establish a held-out quality target and a fallback path to the current model. Baseline agreement alone is insufficient: the baseline can also be wrong. Shadow mode adds API cost and provides no live latency savings because both providers run.

References: [TypeSafe API](https://docs.typesafe.ai/api), [confidence semantics](https://docs.typesafe.ai/confidence).
