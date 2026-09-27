# SL-97 phase 1 — measurement only, no product change

Ticket: `docs/specs/pi-native-single-loop-tickets/97-jev-admission-confident-enough-to-settle.md`.
Contract: `docs/kernel-rpc.md` §32.10–§32.12.3. Tools: `experiments/admission-jev-bank/{build.mjs,replay.mjs,bank-core.mjs}`.
No product code changed; this folder holds raw outputs only.

## 1. Build (refresh) the case bank

Homes: the persona-bench + regular-campaign corpus at `chatrpgv4-wt-pi-coc-v2/.coc` (the repository's dominant
retained-evidence root), every `chatrpgv4-wt-gate-*` worktree's `.coc` (the newest long-gate tables, #17–#23,
including #23 `longgate23-haunting-1350` named in the ticket), and the PipiCOC App home's `.coc` plus its
`ui-sessions/play` session logs.

```
node experiments/admission-jev-bank/build.mjs \
  --out <bank-dir> \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-13ce6a7dd/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-13ce6a7dd-masks/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-32e1d584f/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-d08fa2ebb/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-d08fa2ebb-43/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-d08fa2ebb-43low/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-d64c7a7c4/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-f332d72bc/.coc \
  --home "/Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc/.coc" \
  --sessions "/Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc/agent/ui-sessions/play"
```

Result (`bank-stats.json` in this folder): 6 306 review rows across 247 campaigns, 5 362 paired cases, 944 unpaired.

- **By lane verdict:** authorized 3 566, not_authorized 726, entailed 723, not_player_action 170,
  unavailable (model_error 10 + timeout 153 + bad_output 3) 166, uncertain 2, review_pending 9.
- **By source:** driver:persona-bench 4 785, driver:table 549, session 28.
- Notable gap: gate #19 (`chatrpgv4-wt-gate-d08fa2ebb-43`, `longgate19-haunting-1043`) contributed 0 cases —
  its driver `turn-N.json` files all recorded `"tools": []`, so its 33 retained admission rows cannot be paired
  to any tool call. This is a retained-evidence gap in that run's own logging, not a `build.mjs` defect (confirmed
  by running `build.mjs` against that one home alone: 33 review rows in, 0 cases out, 33 unpaired).
- `chatrpgv4-wt-gate-13ce6a7dd-masks` (`masks-1350-...`) contributed nothing: its playtest run has no `final.json`
  and no matching `campaigns/` entry (it was still in progress when the bank was built), so `build.mjs` correctly
  skips it — nothing to pair yet.

**`bank.jsonl` itself (5 362 cases, ~25.7 MB) is not committed** — it is regenerable read-only evidence, exactly
like the retained campaign/playtest directories it is built from, and this size is out of step with the other
`results/*` folders (raw per-purpose extracts, not the whole bank). Re-run the command above to reproduce it
byte-for-byte from the same evidence.

## 2. Replay through the typed family, live

The Jev credential is exported only in the shell that runs the replay, never printed or written to a file:

```
export EXT_JEV_APIKEY="$(node -e "import('./experiments/single-loop-routing/vault.mjs').then(async m => { const v = await m.readVaultSecret('EXT_JEV_APIKEY'); process.stdout.write(String(v || '')); })")"

node experiments/admission-jev-bank/replay.mjs \
  --bank <bank-dir>/bank.jsonl \
  --out <replay-dir> \
  --port live --per-class 90 --concurrency 6
```

**`--per-class 90` chosen from a `--port shape` dry run first** (packing/routing only, no live calls, no credential
needed): at `--per-class 90` the stratified sample (by lane-verdict bucket: authorized/not_authorized/entailed/
not_player_action/uncertain/review_pending/unavailable) is 461 cases, of which 32 are `cash`-tagged and never call
Jev (lane-only by contract), and the remaining 429 typed-attempted cases pack into 1–4 line-batches each (368×1,
56×2, 4×3, 1×4 batches). That dry run put the ceiling at 496 live HTTP calls, safely under the ~600 the ticket
asked for. The live run in fact made **496 Jev calls** over 429 cases (461 sampled − 32 `cash` lane-only), 31 s
wall clock at `--concurrency 6`.

Outputs in this folder:
- `bank-stats.json` — `build.mjs`'s own stats block (§1 above).
- `replay-live.jsonl` — one row per sampled case (461 rows): route, typed verdict/confidence, per-line verdicts and
  confidences, latency, packed size.
- `replay-live-summary.json` — `replay.mjs`'s own summary: confusion matrix, `by_threshold` at its built-in
  `[0, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95]`, packing-byte and latency quantiles.
- `replay-live-derived.json` — numbers the ticket asked for that `replay.mjs`'s built-in `THRESHOLDS` array does not
  cover, computed directly from `replay-live.jsonl` with the same logic `summarize()` uses (no code changed):
  threshold **0.87** (the fast-path default, §32.11), the confidence histogram per lane-label class and per typed
  verdict, and the total-live-calls accounting. `replay.mjs` was not modified; `THRESHOLDS` there stops at 0.85/0.9,
  so 0.87 is filled in here rather than patched into the script.
- `low-confidence-cases.md` — 20 cases read at typed confidence < 0.6, pulled from `replay-live.jsonl` paired
  against `bank.jsonl`'s `input.proposal`, including the ticket's own #23 t2 case.

### Headline numbers (see `replay-live-summary.json` / `replay-live-derived.json` for full detail)

- **Coverage/agreement, all typed cases (threshold 0):** 351 of 371 labelled cases decided (94.6% coverage),
  exact-verdict agreement 41.3%, admit/refuse agreement 57.0%, 73 false admits, 78 false refusals.
- **At 0.87 (the fast-path default):** 2 of 371 decided (0.5% coverage) — 1 exact agreement, 0 false admits,
  1 false refusal.
- **Latency:** case-round p50 375 ms / p90 548 ms / max 1 229 ms (typed-only, n=351); 386/592/1 229 ms including
  fallback rounds (n=429). This is the whole case's Jev round (parallel batches via `Promise.all`), not a single
  HTTP call's latency when a case has 2+ batches.
- **Confidence overall:** mean 0.455, median 0.44 (n=351) — well under the family default minimum (0.9, §32.10)
  and the fast-path threshold (0.87, §32.11).

## What did not run

Everything the ticket asked for ran: the bank build (with the #23 table and the gate-* homes), the live replay at
a bounded per-class N, the threshold/agreement/latency/confidence tables (0.87 filled in by hand since it is not
in `replay.mjs`'s own array), and the 20-case low-confidence read (including the #23 t2 case). `replay.mjs` needed
no fix — it ran as-is against Node 24's native TypeScript stripping, no flags required.
