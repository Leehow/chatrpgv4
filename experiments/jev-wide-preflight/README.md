# Wide Jev preflight — isolated prototype

## Question

Can one wide, parallel semantic pass over an existing material universe supply most of the evidence an agent needs, leaving the agent to answer rather than discover sources?

This is an authored **static source-retrieval component experiment**, not a campaign, a Keeper substitute, or true-table acceptance. It never runs `resolve`, `apply`, dice, source publication, or world mutation. A positive result cannot establish that a complete gameplay turn needs only one LLM call.

## Existing bench and frozen inputs

Reuse the original 111-page native-text corpus at `.pi/prototypes/jev-pdf-routing-20260919/corpus.json`. Earlier raw runs and adverse results remain untouched. The original PDF hash and exact corpus-file hash bind the case set. No prebuilt graph, generated summary, expected page, or expected answer enters a Jev request.

`cases.json` contains the seven earlier diagnostic queries plus independently authored source-grounded probes. Every supported requirement has an exact quote and one or more supporting physical pages. These labels are frozen before this prototype's live responses. This is not a representative production test set or a calibrated accuracy claim. Queries with unsupported subquestions retain those gaps instead of inventing a gold answer.

## Shape

1. For **one query at a time**, partition all substantive native-text pages mechanically into requests no larger than 30,000 UTF-8 JSON bytes. This conservative prototype bound is not Jev's official token limit.
2. In each request, ask two independent Nouls per page: direct support for **at least one part** of the request, and materially useful context. The page need not answer the entire compound query.
3. Evaluate HTTP concurrency 1, 4, and 16 against exactly the same query/corpus. Different queries and comparison arms do not run simultaneously. Rotate arm order by query/repeat. This measures individual-query latency, not the amortized cost of asking seven unrelated queries together.
4. Rank by direct-support probability, then useful-context probability. Produce top-5, top-10, and top-15 packets with exact original pages and source positions. There is no universal confidence cutoff or keyword-based intent filter. Missing judgments remain unknown.
5. Compare the packets with hidden page-level requirements. Report coverage, omissions, packet bytes, request latency, full material-ready latency, failures, and estimated Jev cost.
6. For actual sufficiency, use the predeclared cases `clinic_zh`, `heat_water_rules`, and `unsupported_mri`, repeat 1, concurrency 16, top-10 packets. Run matched cold **tool-enabled Pi readers** using `grok-build/grok-4.6`: packet-plus-catalog versus catalog-only. Let each reader obtain more source text when necessary. Count actual supplementary reads from tool traces, not self-reports. Missing cases/arms are explicitly skipped, never replaced by a better result. The runner deliberately leaves `writer_evaluated: false` until this separate step occurs.

The preflight packet is injected into the reader's **first model request**, alongside the same source index the baseline receives. There is no mandatory initial packet-read tool call. Each arm is a separate cold Pi process with the same model, low thinking setting, tools and system prompt, a fresh scratch cwd, no session/context files/skills, and only the Grok provider extension. TypeSafe credentials are removed from the reader environment. The final reader retains judgment: it may reject a suggestion, acknowledge missing evidence, or supplement it. Gold, evaluation notes, other arms, and metrics must not enter its context. New source selection never constitutes permission to disclose Keeper-private information to a player.

## Run

From the repository root, no key or network is required for mechanical checks and request inventory:

```sh
node --test experiments/jev-wide-preflight/core.test.mjs experiments/jev-wide-preflight/cli.test.mjs experiments/jev-wide-preflight/cases.test.mjs experiments/jev-wide-preflight/reader-probe.test.mjs
node experiments/jev-wide-preflight/run.mjs --describe
```

With `TYPESAFE_API_KEY` securely mounted into the process environment:

```sh
node experiments/jev-wide-preflight/run.mjs --case clinic_zh --concurrency 1,4,16
node experiments/jev-wide-preflight/run.mjs --concurrency 1,4,16 --repeat 1
```

Run the fixed, paired tool-enabled reader probes against an actual live-run directory:

```sh
node experiments/jev-wide-preflight/reader-probe.mjs /absolute/path/to/live-run
```

The probe retains actual Pi JSONL (`tool_execution_start/end`, final `message_end` usage), stderr, prompts, answers and metrics in a new `readers-*` directory. `--one` is only a startup diagnostic, not the paired comparison. Both arms receive the same full source index; only the preflight arm additionally receives the material packet. Reader order alternates by case. The reported workflow time is reader-process wall time plus the measured Jev preflight for that arm; shared pre-existing native extraction/index preparation is excluded for both. Source access through bash or outside the scratch cwd invalidates the automatic read count. Rereading a page already in the initial packet is counted separately from obtaining a new page. A zero-read answer still requires independent source-quality review.

Recorded findings: [RESULTS-20260921.md](RESULTS-20260921.md).

Optional preflight-runner paths: `--corpus`, `--cases`, `--out`. `JEV_PREFLIGHT_CORPUS` can select the original corpus when running in an isolated worktree. `--describe` prints the exact number of planned requests without sending them. No old evidence is overwritten. Every live run creates a new directory under `.pi/prototypes/jev-wide-preflight-20260921/runs/` with immutable inputs, actual requests/responses, material packets, and metrics. Credentials are used only in the request header and never persisted.

No local decision cache or automatic retry is used. Provider-internal caching is unknown. Every request has a 30-second timeout; all concurrency arms receive the same `(group count + 1) * 30 seconds` overall allowance, so a 120-second ceiling cannot systematically censor the serial arm. HTTP failures and missing judgments remain visible. A malformed provider schema marks the arm invalid and stops later arms; transport-partial runs exit unsuccessfully too. Neither is a semantic failure verdict. Attempt latency (including failures) and successful-request latency are separate. Top-10 material-ready time includes request/response evidence recording but excludes material-packet and evaluation-output writes. Visual-only requirements are reported separately from native-text retrieval misses.

The price basis is the official Models page checked on 2026-09-21: USD 0.042 per million input tokens, free output. Reported input and output usage are retained. Missing usage makes the total cost estimate null; a known-usage subtotal remains available. These are **estimates**, not billing receipts.

## Context-aware incremental follow-up

The second experiment asks whether already supplied material is sufficient and, if not, selects only candidate pages judged to add necessary missing evidence. It does **not** apply a fixed top-K. The host subtracts exact existing source ranges and projects the combined source in original page/offset order.

```sh
node --test experiments/jev-wide-preflight/incremental-core.test.mjs experiments/jev-wide-preflight/incremental-cases.test.mjs
node experiments/jev-wide-preflight/incremental-run.mjs --describe
node experiments/jev-wide-preflight/incremental-run.mjs --repeat 2 --concurrency 16
```

The live command requires the already mounted TypeSafe credential. It writes a new directory under `.pi/prototypes/jev-incremental-preflight-20260921/runs/`. Six source questions each have none/partial/full/summary/stale/conflict conditions. V2 uses matched agreeing/disagreeing notes and separate raw-model versus host-error counters. Old wide-retrieval cases and both incremental runs remain unchanged. Whole-page and exact-range deduplication are host guarantees, not model semantic scores. Unsupported source details and question-extraneous contradictions must be distinguished from missing material.

Results, including failures: [INCREMENTAL-RESULTS-20260921.md](INCREMENTAL-RESULTS-20260921.md). The recorded prototype does not yet reliably achieve minimal supplementation; a completed experiment is not a model-quality pass or a production rollout.

## What settles the hypothesis

- Primary: all separately labeled required facts/procedures have a supporting original in the selected packet, at a stated packet size.
- Reader check: correct source-supported answer, low actual supplementary reads, and no invented missing facts. An absence of tool calls alone is not success: the answer must still be right.
- Timing: material-ready latency plus actual reader latency, compared at identical model/settings/tool access. Jev-only latency cannot establish a whole-workflow speedup.
- Failure controls: incomplete answers, unavailable service, irrelevant requests, image/native-text gaps, and misleading candidates remain in the results.

Top-K gold coverage is only a page-level proxy; it does not prove that the agent interpreted the evidence correctly. Native-text sparsity is an explicit gap, not proof that the PDF lacks a map or a fact. Rule execution, real player experience, final narration and end-to-end product acceptance require the project's genuine-play method separately.
