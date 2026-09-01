# Pi-Coc per-turn context growth — measured investigation

- `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`. Codex-host implementation, adapters,
  prompts, launchers, tests, and documentation are **off-limits** for this work.
- Status: **read-only investigation**. No runtime, prompt, contract, or KP
  behaviour was changed. No playtest evidence was modified or deleted.
- Branch: `claude/pi-coc-context-growth-20260901` (worktree
  `../chatrpgv4-wt-context-growth-20260901`, based on `0.8.1a`).
- Evidence: `.coc/playtests/dirgraph-smoke-20260901/` (grok-4.5 live KP,
  *The Haunting*, `zh-Hans`, `pi-coc --mode rpc`, 2026-09-01) plus
  `.pi/coc-agent/telemetry/turns.jsonl`.

---

## 0. The one-line answer

**The panel number that alarmed us is not a context size.** `tokens 入 273.8k`
is the *sum of billed input across the internal model calls of one player turn*,
not the size of any single request. It grew for three independent reasons, in
descending order of cost:

1. **Prefix-cache churn from a mutating tool set** — the advertised tool list
   changed 78 times in the session, and every change re-billed the whole
   context as fresh input. **89.2% of all billed input tokens in the session were
   re-billings of context the provider had already seen.**
2. **A finalization livelock** — one player input ran 28 internal model calls,
   23 of them a failed retry storm on `turn.finalize` / `narration.review`. The
   closure contract consumed **22 of 54 model calls and 42% of the session's
   model spend**, and the last turn never produced player output at all.
3. **A large fixed prefix** — every model call carries a 19.1k (setup) /
   **33.0k (play)** token prefix before a single word of transcript.

The conversation transcript — the thing `scene.context` trimming and the
`待折叠` fold both target — is the *smallest* of the three. It never exceeded
~40k tokens, and the fold that would have shrunk it **never fired once**.

---

## 1. Method and evidence integrity

All numbers below are either (a) provider-reported token counts recovered from
`rpc-events.jsonl`, (b) exact byte counts of files or serialized JSON, or (c)
exact character counts already recorded by `lib/context-probe.ts` into turn
telemetry. Nothing in the tables is an estimate. Where a quantity **cannot** be
measured from the preserved evidence it is called out explicitly in §7.

Evidence used, all read-only:

| Path | What it gave |
| --- | --- |
| `.coc/playtests/dirgraph-smoke-20260901/rpc-events.jsonl` | 134 `message_end` events; the 54 assistant ones carry `usage.input` / `usage.cacheRead` / `usage.output` per model call |
| same file, `entry_appended` | 151 `coc-tool-working-set` + 26 `…-replan` entries with exact `schema_bytes` and the exact advertised tool list per revision |
| `.pi/coc-agent/telemetry/turns.jsonl` (last 6 records) | per-turn `context_probe` **per model call**, `context_fold` stats, `context_usage` |
| `plugins/coc-keeper/pi/prompts/*.md`, `session-roles.json` | exact system-prompt component bytes |
| `plugins/coc-keeper/pi/lib/typed-tools.ts` | exact `description` + `parameters` bytes for all 102 typed tools |
| `~/.npm-global/.../@earendil-works/pi-coding-agent/dist/core/system-prompt.js` | how the system prompt is assembled |
| `~/.npm-global/.../@earendil-works/pi-ai/dist/api/openai-responses.js` | how `tools` and `input` are placed in the provider request |

No `pi-coc` session was launched and no fake-KP shortcut script was written; the
investigation is entirely post-hoc over preserved evidence.

---

## 2. What the panel numbers actually are

The four panels reconcile **exactly** with the per-call provider usage, which
proves the interpretation:

| Panel | Internal model calls | Σ `usage.input` | Σ `usage.cacheRead` |
| --- | --- | --- | --- |
| turn 1 `tokens in 76.7k … cache read 43.1k` | 5 (`A#2`–`A#6`) | 76,668 | 43,136 |
| turn 3 `tokens in 201.9k … cache read 38.9k` | 7 (`A#8`–`A#14`) | 201,873 | 38,912 |
| turn 4a `1 call, 0 tokens` | 1 (`A#15`, `stopReason: error`) | 0 | 0 |
| turn 4b `tokens in 273.8k … cache read 367.1k` | 11 (`A#16`–`A#26`, after `auto_retry`) | 273,780 | 367,104 |

```bash
python3 - <<'PY'
import json
p='.coc/playtests/dirgraph-smoke-20260901/rpc-events.jsonl'
cur=None; agg={}
for line in open(p):
    try: o=json.loads(line)
    except: continue
    if o.get('type')=='response' and o.get('command')=='prompt':
        cur=o['id']; agg.setdefault(cur, {'calls':0,'inp':0,'cr':0,'out':0})
    if o.get('type')=='message_end' and o['message'].get('role')=='assistant':
        u=o['message'].get('usage') or {}
        d=agg[cur]; d['calls']+=1; d['inp']+=u.get('input',0)
        d['cr']+=u.get('cacheRead',0); d['out']+=u.get('output',0)
for k,v in agg.items(): print(k, v)
PY
```

So **`tokens 入` is a per-turn *sum*, not a per-call context size.** The largest
single request in the whole session was 96,630 tokens (`A#54`), 19% of grok-4.5's
500k window. There is no context-window problem. There is a *volume* problem.

Full per-player-turn cost, at grok-4.5's published rates from
`pi-ai/dist/providers/data/xai.json` (`input $2/M`, `cacheRead $0.30/M`,
`output $6/M`):

| Player turn | model calls | tool execs | billed input | cacheRead | ctx/call avg | max ctx | $ |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| T0 OAuth fail | 1 | 0 | 0 | 0 | — | — | 0.000 |
| T1 chargen | 5 | 7 | 76,668 | 43,136 | 23,960 | 28,330 | 0.179 |
| T2 confirm | 1 | 1 | 694 | 28,288 | 28,982 | 28,982 | 0.010 |
| T3 open table | 7 | 8 | 201,873 | 38,912 | 34,397 | 36,743 | 0.427 |
| T4 accept job | 12 | 17 | 273,780 | 367,104 | 58,262 | 62,920 | 0.677 |
| **T5 go to house** | **28** | **34** | **500,694** | **1,766,528** | **80,972** | **96,630** | **1.733** |
| **session** | **54** | **67** | **1,053,709** | **2,243,968** | | | **3.03** |

T5 produced **zero player-visible narration** before `pi` exited. $1.73 and
28 model calls bought nothing.

---

## 3. Measured attribution: what is in each call

### 3a. The fixed prefix (exact, no estimation)

The cleanest possible measurement: the **first model call of a fresh `pi`
process**, where the conversation is essentially empty. `context_probe` records
the exact model-visible transcript size for that call; the provider records the
exact billed context.

| Session generation | role | probe: transcript msgs / chars | probe `est_tokens` | provider `input + cacheRead` | ⇒ prefix |
| --- | --- | --- | ---: | ---: | ---: |
| gen 2 (`A#2`) | `setup` | 4 msgs / 743 chars | 186 | **19,104** | **≈ 18,900 tok** |
| gen 3 (`A#8`) | `play` | 4 msgs / 717 chars | 180 | **33,000** | **≈ 32,800 tok** |

**Every one of the 54 model calls paid that prefix.** Over the session it is
roughly 54 × 33k ≈ 1.7M tokens of the 3.30M transferred — a little over half of
all context traffic, before any transcript at all.

> **Why this went unnoticed.** `lib/context-probe.ts:24-26` states that its
> sizes "track what the provider is actually billed for". They do not: the probe
> measures `event.messages` only. For turn 4b it reported 39,967 `est_tokens` on
> the last call while the provider billed 58,191 for the same call, and it
> reported 39,967 against a per-turn provider total of 640,884. Everything this
> investigation found lives in the gap the probe does not look at — the system
> prompt, the tool definitions, and the number of calls. Correcting that
> docstring and widening the probe is proposal **A2**.

Exact byte composition of the system-prompt half of that prefix, reconstructed
by calling pi's own `buildSystemPrompt` with the same role manifest
(`plugins/coc-keeper/pi/session-roles.json`) and the launcher's actual flags
(`pi-coc` line 483-492 passes `--no-builtin-tools --approve --no-context-files
--append-system-prompt <role prompt>`):

| Component | setup | play |
| --- | ---: | ---: |
| pi base skeleton (incl. `cwd` line and the one-line tool snippet) | ~1,731 B | ~1,731 B |
| `<available_skills>` index (name+description+location) | 3,920 B (8 skills) | **7,290 B (15 skills)** |
| `--append-system-prompt` role prompt | 25,356 B | **50,760 B** |
| project context files (`AGENTS.md`) | **0 B** — `--no-context-files` | **0 B** |
| **total system prompt** | **≈ 31.0 KB** | **≈ 59.8 KB** |

(The skeleton varies by a handful of bytes with the registered one-line tool
snippet, which is not recorded in the evidence; everything else is exact.)

`--no-context-files` is passed by the launcher, so `AGENTS.md` (31,363 B) is
**not** in the model context. That was checked and ruled out rather than assumed.

### 3b. Tool definitions (exact bytes, per call)

`coc-tool-working-set` entries record `schema_bytes` for every projected working
set. Adding the typed tools' `description` bytes (from `typed-tools.ts`, which
`schema_bytes` does **not** count — it serializes `parameters` only, see
`tool-working-set.ts:401` `schemaByteLength`) gives the full advertised payload.
23 distinct working sets appeared:

| role / phase / stage | tools | `schema_bytes` | + typed descriptions | occurrences |
| --- | ---: | ---: | ---: | ---: |
| play / live_turn / acting (max) | 12 | 21,238 | 1,819 | 13 |
| play / live_turn / acting | 9 | 14,267 | 1,056 | 6 |
| play / pending_finalization / review_ready | 6 | 9,722 | 1,600 | 35 |
| play / pending_finalization / review_ready (min) | 4 | 1,799 | 312 | 6 |
| setup / opening / acting (max) | 13 | 12,347 | 4,089 | 4 |

Whole catalogue for reference: **102 typed tools, 170,632 B of `parameters` +
30,739 B of descriptions**. The working set never advertised more than **12** of
them. `WORKING_SET_TOOL_BUDGET = 20` (`tool-working-set.ts:27`).

**Answer to "is the tool-schema surface a fixed per-call cost?" — No, and that
is the problem.** It is small (≤ 23 KB, roughly 6k tokens) but it is *not fixed*:
it moved 78 times, and see §3d.

```bash
# exact advertised payload of the whole typed-tool catalogue
node --experimental-strip-types --input-type=module-typescript -e '
import { defaultTypedToolCatalog } from "/Users/haoli/leehow/code/chatrpgv4/plugins/coc-keeper/pi/lib/typed-tools.ts";
const byName = defaultTypedToolCatalog().byName;
const B = (s: string) => Buffer.byteLength(s, "utf8");
let d = 0, p = 0;
for (const [, c] of byName as Map<string, any>) { d += B(c.description ?? ""); p += B(JSON.stringify(c.parameters)); }
console.log(byName.size, "typed tools; descriptions", d, "B; parameters", p, "B");
'
# -> 102 typed tools; descriptions 30739 B; parameters 170632 B
```

### 3c. The transcript (exact chars, from `context_probe`)

Per-model-call class breakdown, straight out of
`.pi/coc-agent/telemetry/turns.jsonl` `steps[].context_probe.by_class`. Play
session, last call of each turn:

| turn | msgs | chars | user | KP prose | thinking | tool args | **tool results** | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| T3 open table (call 7) | 19 | 74,696 | 9 | 0 | 694 | 1,733 | **70,713 (95%)** | 1,547 |
| T4a (call 1) | 22 | 76,742 | 29 | 481 | 760 | 1,733 | **70,713 (92%)** | 3,026 |
| T4b (call 11) | 49 | 159,867 | 29 | 481 | 1,802 | 6,032 | **148,497 (93%)** | 3,026 |

Tool results are **92–95%** of transcript characters; KP prose — the thing the
table actually reads — is **0.3%**. That confirms the premise
`lib/context-probe.ts` was written on.

What is inside those tool results (66 results, 301,667 model-visible chars total
across the session):

| Source | results | chars | share |
| --- | ---: | ---: | ---: |
| **skill / reference docs read via the `read` tool** | 11 | **154,948** | **51%** |
| `scene.context` | 3 | 35,894 | 12% |
| `turn.finalize` (8 of 9 are **failures**) | 9 | 30,274 | 10% |
| `coc_discover` | 11 | 28,912 | 10% |
| `session.resume` | 2 | 13,234 | 4% |
| `turn.output_context` | 4 | 9,261 | 3% |
| `narration.review` | 8 | 6,908 | 2% |
| everything else (13 kinds) | 18 | 22,236 | 7% |

Cutting the same data a second way: **18 of the 66 results are `ok:false`
envelopes carrying 33,675 chars (11%)** — failure text the livelock generated
and then had to resend on every later call.

Individual worst offenders: `coc-keeper-play/SKILL.md` **38,684 chars**,
`coc-character/SKILL.md` 29,447, "Ordinary-Turn Tooling Detail" 23,407,
`coc-main/SKILL.md` 23,125. Each is read once and then **resent verbatim on
every subsequent model call for the life of the process**. The system prompt
already carries a 7,290 B `<available_skills>` index pointing at them.

`scene.context` at 12% is real but is *not* the driver — confirming the prior
finding, with the exact number.

### 3d. The prefix-cache churn — the actual biggest line item

pi's `openai-responses` adapter puts tool definitions in the top-level
`params.tools` field of the request (`pi-ai/dist/api/openai-responses.js:222`)
and the transcript in `params.input`. Changing the advertised tool set therefore
changes the request prefix. The correlation in this run is close to
deterministic:

| cache outcome of a call | calls | mean working-set changes since previous call | calls with **zero** change |
| --- | ---: | ---: | ---: |
| **HIT** (`cacheRead ≥ 60%` of ctx) | 28 | 0.36 | **25 of 28** |
| **partial** | 13 | 3.69 | **0 of 13** |
| **full miss** (`cacheRead < 2,000`) | 11 | 1.73 | 3 (all three are process starts) |

Not one of the 13 partial-miss calls had a stable tool set. Not one.

The script that produces this table is in §9 ("working-set churn vs cache
outcome"); it walks `rpc-events.jsonl` in line order, tracking the last
`coc-tool-working-set` revision string and attributing every change to the next
assistant `usage` record.

Session totals:

| | tokens | $ |
| --- | ---: | ---: |
| context transferred over 52 real calls | 3,297,677 | |
| billed as **fresh input** | **1,053,709 (32.0%)** | 2.107 |
| served from prefix cache | 2,243,968 (68.0%) | 0.673 |
| fresh input if the prefix had only ever been *appended to* | **113,552** | 0.227 |
| **excess re-billing caused by the prefix moving** | **940,157 — 89.2% of billed input** | ≈ **1.60** |

A perfectly stable append-only prefix would have cut the session's model bill
from **$3.03 to ≈$1.43** with **zero** change to what the KP sees.

The oscillation is worse than "the set changes when the stage changes": the
extension emits **27 transient working sets of exactly 1 tool / 0 schema bytes**
sandwiched between two identical full sets (e.g. `WS#1` 13 tools → `WS#2` 1 tool
→ `WS#3` the same 13 tools, within 3 event lines). Each of those flickers is a
prefix rewrite that buys nothing.

### 3e. Attribution summary for one representative live-turn call

For `A#26` (last call of T4, provider ctx **58,191 tokens**, transcript 159,867
model-visible chars):

| category | measured size | fixed per call? |
| --- | --- | --- |
| pi base + `<available_skills>` + `host-system-play.md` | **≈ 59.8 KB** | **fixed** — identical on all 28 play-session calls |
| advertised tool definitions | 1,799 – 23,057 B (this call: 9,722 + 1,600) | **varies per call**; the variation is what breaks the cache |
| transcript — skill/reference docs pulled in by `read` | **86,305 chars** already resident at `A#26` (97,910 by the end of the play session) | **cumulative, monotonic** |
| transcript — tool results | 148,497 chars (93% of transcript) | **cumulative** |
| transcript — thinking | 1,802 chars | cumulative (fold-eligible) |
| transcript — KP prose + player input | 510 chars (0.3%) | cumulative, negligible |

Exact byte→token conversion for this call is **not derivable** — see §7.

---

## 4. Why 7 (and 11, and 28) internal model calls for one player input

Reconstructed call/tool interleaving:

```
T3 开桌   [A#8] read session.resume [A#9] read discover [A#10] npc.reaction
          [A#11] discover [A#12] state.record_npc_engagement
          [A#13] evidence.table_opening [A#14] → narration
T4 接单   [A#16] read scene.context npc.query actions.list
          [A#17] discover×3 read  [A#18] state.record_clue [A#19] state.record_clue
          [A#20] state.item_grant state.cash_grant [A#21] state.item_grant
          [A#22] state.journal
          [A#23] turn.output_context  [A#24] narration.review  [A#25] turn.finalize
          [A#26] → narration
T5 去宅   [A#27] (16,451 output tokens, stopReason=length, no text, no tool)
          [A#28] discover×2 scene.context [A#29] state.move_scene
          [A#30] scene.context actions.list read
          [A#31] state.advance_time state.journal state.advance_time<ERR>
          [A#32] output_context [A#33] review [A#34] review [A#35] discover
          [A#36] output_context [A#37] review [A#38] discover
          [A#39] finalize [A#40] finalize [A#41] finalize
          [A#42] output_context [A#43] review [A#44] finalize [A#45] finalize
          [A#46] read discover [A#47] discover
          [A#48] finalize [A#49] finalize [A#50] review [A#51] finalize
          [A#52] review [A#53] review [A#54] review   ← pi exits, no output
```

**The loop count is not intrinsic to the turn contract.** `T4` shows the
intrinsic cost: the closure contract `turn.output_context → narration.review →
turn.finalize` is **3 model calls plus 1 delivery call**, on top of ~7 calls of
real play. That is the design and it worked.

`T5` is a **livelock**, and the tool results name the cause. Reading the failed
envelopes in order:

| after | verdict |
| --- | --- |
| `A#35` | `stage_forbidden`: `session.resume` not available in stage `review_ready` |
| `A#37` | `idempotency_conflict`: `narration.review decision_id already owns another turn/revision/draft/findings request` |
| `A#39`,`A#40`,`A#41` | `missing_param`: **required parameters: `decision_id`, `revision`** |
| `A#43` | `idempotency_conflict` |
| `A#44` | `nonretryable_repeat_blocked`: identical non-retryable `turn.finalize` failure already returned |
| `A#45`,`A#49` | `missing_param`: `decision_id`, `revision` |
| `A#46` | `phase_forbidden`: `state.record_clue` not allowed in phase `pending_finalization` |
| `A#48`,`A#51` | `nonretryable_repeat_blocked` |
| `A#52` | `unknown_semantic_handle` |
| `A#50`,`A#53` | `idempotency_conflict` |

And the KP's own reasoning block on `A#40` states the contradiction verbatim:

> "There's a conflict — the tool schema requires `decision_id` and `revision`
> but constitution says host binds those."

The KP is caught between the `coc_turn_finalize` schema, which lists
`decision_id` and `revision` as required parameters, and the host prompt /
Model-Facing Identifier Law, which tells it the host binds machine identity and
the model must not relay opaque handles. **The follow-up pass in B1 shows how
this resolves: the host does bind both values and delivers them in
`finalize_operation.prefilled_arguments` — 18 times in this session — and the
KP's error is discarding the prefill rather than merging it through.** It obeys
the prompt, gets
`missing_param`, retries, trips `nonretryable_repeat_blocked`, varies the
semantic payload, trips `idempotency_conflict`, and never escapes. Each retry
also appends its own ~5.6 KB error envelope to the permanent transcript, so the
loop feeds the very context growth it is trapped in.

**Cost of the closure contract across the whole session:** 22 of 54 model calls
(41%), 366,504 billed input + 1,415,296 cacheRead tokens, **$1.16 of $2.78**
(42%) of model spend — for **2 turns that actually closed**.

`A#27` deserves a separate note: 16,451 output tokens, `stopReason: "length"`,
zero text, zero tool calls — 16,400 streaming deltas of reasoning that hit the
output cap and produced nothing. That is a second, distinct failure mode
(runaway reasoning) and it is the wall-clock explanation for the long silent
stretch at the start of T5.

---

## 5. `待折叠` — what it is, and why it never fired

`待折叠 N%` is rendered at `plugins/coc-keeper/pi/lib/turn-telemetry.ts:293-298`
from `context_probe.saving_percent`. It is **a projection, not an action**: it
says "an epoch fold *would* remove N% of the current transcript". It is printed
only when `saving_percent ≥ 20`.

The actual fold is `plugins/coc-keeper/pi/lib/context-fold.ts`, wired at
`plugins/coc-keeper/pi/extensions/index.ts:13433` on the `context` event.

**Trigger conditions (all must hold):**
1. `settings.enabled` — on unless `PI_COC_CONTEXT_FOLD=off|0|false`.
2. `atTurnBoundary` — the *last* message is the player's, i.e. **only the first
   model call of a turn**.
3. `estimateTokens(pendingChars) > thresholdTokens`, default
   `DEFAULT_FOLD_THRESHOLD_TOKENS = 20000`, where `pendingChars` counts only
   **closed-turn** tool results ≥ `MIN_FOLD_CHARS = 400` plus closed-turn
   thinking.

**What it keeps:** player input, KP prose, tool-call *arguments*, and every
result from the *live* turn. **What it replaces:** each closed-turn tool result
payload with a frozen structural stub (`{folded, tool, canonical_operation, ok,
full_result_sha256, folded_chars, note}`), and it drops closed-turn `thinking`
blocks below a monotonic watermark. Stubs are computed once and frozen, so the
folded prefix stays byte-stable.

**It never fired in this session.** `epochs: 0` and `folded_results: 0` on
every one of the four turn records in `.pi/coc-agent/telemetry/turns.jsonl`.
The two turns that had a closed turn behind them (`seq 2` and `seq 3` of the
play session — the first two records show `pending_chars: 0` because nothing had
closed yet) read:

```json
"context_fold": {"enabled": true, "threshold_tokens": 20000, "epochs": 0,
                 "folded_results": 0, "folded_chars": 0, "stub_chars": 0,
                 "pending_chars": 71437, "folded_this_call": 0}
```

`estimateTokens(71437) = ceil(71437/4) = 17,860` against a threshold of
**20,000**. The fold sat **10.7% below its own trigger** for the entire session.
The `待折叠 91%` / `44%` panels were reporting a saving that was never taken.

**Two bad interactions with this loop:**

1. **The fold is structurally blind to a runaway turn.** Fold candidates are
   only messages *before the last user message*. T5's 28 calls, 34 tool
   executions and ~33k output tokens are all *inside* one turn, so every byte of
   the livelock is "live-turn" and by design exempt. The fold gets exactly one
   chance per turn — the first call — and at that moment T5's closed pile was
   still 17,860 est-tokens. **The worse a single turn goes, the less the fold can
   do about it.**
2. **The fold's own accounting under-reads Chinese.** `estimateTokens` is pi's
   `chars/4` heuristic and `context-probe.ts:24-28` already documents that "it
   underestimates Chinese prose". The threshold is compared in those
   under-counted units, so the real trigger point is higher than 20k actual
   tokens.

The fold is not *harmful* here. It is aimed at the third-largest cost and it is
mis-tuned by ~11%.

---

## 6. Fixed per call vs cumulative — the answer that picks the fix

| | fixed per call | cumulative | multiplier |
| --- | --- | --- | --- |
| system prompt (≈59.8 KB play) | **✔** | | |
| tool definitions (1,799–23,057 B) | ✔ in size, **✘ in identity** — it moves | | |
| transcript / tool results | | **✔** (92–95% of transcript) | |
| internal model calls per player input | | | **5 → 7 → 11 → 28** |
| prefix invalidation | | | **turns cheap cacheRead into 6.7× costlier input** |

Read together: **trimming a projection attacks the smallest term.** Even
deleting `scene.context` entirely (35,894 chars, 12% of tool-result chars) would
not have changed the shape of this session. The two terms that matter are the
**call multiplier** and the **prefix stability**, and they multiply each other —
a livelock is expensive precisely *because* each of its calls re-bills a growing
context at full input price.

---

## 7. What the preserved evidence does **not** settle

State honestly rather than estimate:

1. **The internal composition of the 33,000-token play prefix.** The system
   prompt is 59,781 B (±~10 B, §3a) and the logged working set is ≤ 23,057 B, but
   grok-4.5's tokenizer is not available offline, the provider request body is
   recorded nowhere (`rpc-wire.jsonl` carries only RPC framing), and — decisive —
   **the first `coc-tool-working-set` entry is emitted *after* the first model
   call**, so the tool set actually advertised on `A#8` is not in the evidence.
   Naive `bytes/4` accounts for only ~15k of the 33k. Roughly 18k tokens of that
   prefix are unattributed. *Do not act on a guess about this.*
2. **Whether the causal mechanism of the cache misses is really the `tools`
   field.** The correlation is as strong as post-hoc evidence gets (0 of 13
   partial-miss calls had a stable tool set; 25 of 28 hit calls did) and the
   request layout makes it the obvious mechanism, but on partial misses the
   surviving cached prefix clusters oddly at 16,768–19,712 tokens, which a pure
   "tools change ⇒ everything after invalidates" story does not by itself explain.
3. ~~**Whether the `decision_id`/`revision` contradiction is a schema bug, a
   prompt bug, or a host-binding regression.**~~ **Settled 2026-09-01 — see the
   revision note in B1.** It is neither a schema bug nor a host-binding
   regression: `finalize_operation` was delivered 18 times with both values
   prefilled, `actionable` was never false, and the wire card carries an
   explicit "merge prefilled_arguments unchanged" instruction. It is a
   model-facing wording problem — the KP reads `"idempotency key"` on the field
   and the Skill's correcting sentence sits 200 lines away.

**The run that would settle all three**, and it is a sanctioned method — one
real `pi-coc --mode rpc` session with a live model, one player line at a time,
adding *observation only*:

- record the serialized provider request body (or at least
  `params.tools` names + a byte length and the `input` message count) once per
  model call, into the existing `turn-telemetry` JSONL;
- emit the `coc-tool-working-set` entry **before** the first model call, not
  after;
The first two bullets are pure observation and settle questions 1 and 2. A
third, **separate** run would settle how much the fold is worth: the same
opening player lines with `PI_COC_CONTEXT_FOLD_TOKENS` lowered so the fold
actually fires, against the current default. That arm **does** change what the
KP sees (proposal B3) and therefore needs sign-off before it is run — it is not
part of the observation-only run.

Ten player turns is enough. `context-probe.ts` already computes
`prefix.status ∈ {first, append_only, rewritten, reset}` per call and it reported
`rewritten_calls: 0` throughout — meaning the *transcript* was always append-only
and the invalidation is happening **outside** what the probe watches. Extending
the probe to the tools field is the single highest-value observability change.

---

## 8. Ranked proposals

The split below is deliberately strict. A proposal is "safe" only if the KP's
context, instructions, affordances, tool results and retry latitude are all
byte-for-byte what they are today. Anything that changes what the KP sees or
what it is allowed to do — **even a mechanism that already exists and is already
enabled** — is Class B, needs user sign-off, and is not implemented here.

That strictness makes Class A small. That is itself a finding: only one of the
levers is free.

### Class A — safe: no change whatsoever to what the KP sees

**A1. Stop the transient 1-tool working-set flickers.** *(saving: a large share
of the 940,157 excess input tokens — the exact share needs A2's instrumentation;
risk to KP behaviour: none)*
27 times in this session the advertised set collapsed to 1 tool / 0 schema bytes
and immediately restored to the **byte-identical** previous set (`WS#1` 13 tools
→ `WS#2` 1 tool → `WS#3` the same 13 tools, inside 3 event lines). No model call
happens during the flicker, so the KP never observes the collapsed set — but the
provider sees the tool list change twice, and the prefix is rewritten twice for
zero semantic effect. The fix is a publication guard: **do not re-publish a
working set when the resulting advertised tool list is identical to the one
currently in force.** Nothing about the KP's affordances changes; only the
number of times the same list is announced.
Before implementing, trace *why* the projector emits the 1-tool set — it may be
a load-bearing reset for an internal gate rather than a stray write.

**A2. Instrument the request prefix.** *(saving: 0 directly; unblocks
everything else; risk: none)*
Add per-model-call `tools_revision`, `tools_bytes`, `tools_names_hash` and the
`input` message count to the existing `turn-telemetry` step record, and emit the
`coc-tool-working-set` entry **before** the model call instead of after. Also
correct the docstring at `lib/context-probe.ts:24-26`, which claims the probe's
sizes "track what the provider is actually billed for" — they track the message
array only, which is why this cost was invisible (§3a). This closes all three
open questions in §7 and should land first; every saving estimate below is
provisional until it does.

### Class B — changes what the KP sees or does. **Needs user sign-off. Not implemented.**

Ranked by measured cost of the problem each one addresses.

**B1. Stop the KP discarding the finalize arguments the host already prefills.**
*(addresses the 23 wasted calls and $1.20 of T5, and the fact that T5 delivered
nothing; risk: changes what the KP is told about identifier ownership)*

> **Revised 2026-09-01 after a follow-up evidence pass.** The original B1 said
> the host does not bind `decision_id` / `revision` and that the schema and the
> identifier law contradict each other. **The first half is wrong.** The host
> *does* bind them, and did so throughout the recorded session. The correction
> is kept in full below because the wrong version was specific and confident,
> and a reader who saw it needs to know exactly which part failed.

Measured on the same evidence (`rpc-events.jsonl`, session
`dirgraph-smoke-20260901`):

| | count |
| --- | ---: |
| `finalize_operation` delivered to the KP | **18** |
| `agency_review_operation` delivered | 18 |
| `pending_narration_draft_status.actionable` = `false` | **0** |
| draft status values seen | `not_submitted` 9, `available` 8 |
| `missing_param` on `coc_turn_finalize` | 20, all `required parameters: decision_id, revision` |

`coc_operation_turn_output.py` builds `finalize_operation.prefilled_arguments`
with `decision_id = f"{journal_decision_id}:finalize"` and `revision`, and
`coc_mcp_wire.py` rebuilds the same card on the wire with an
`argument_contract.instruction` that reads *"Merge prefilled_arguments
unchanged, add only missing_arguments, and invoke directly without
coc_discover."* Both fired. `draft_contract_usable` never went false, so the
gate at `coc_operation_turn_output.py:2582` never dropped the card, and the
wire's `cards_survive` gate never stripped it.

**The KP received the two values 18 times and did not merge them.** Its own
reasoning says why — *"the tool schema requires decision_id and revision but
constitution says host binds those"*, and *"the constitution says never invent
those — they're host-bound"*. It was right that the host binds them and wrong
about what to do next: the binding is delivered *to* it, in the card, to be
copied through.

Where the misreading comes from is unchanged and still worth fixing: the
`investigator` field description says *"the host binds the exact canonical
identity"* for a value the KP must nonetheless pass, and the Model-Facing
Identifier Law says *"the machine re-attaches identity after the model's
semantic payload"*. Neither statement is about `decision_id`, and the
`decision_id` description on `turn.finalize` is four words — `"idempotency
key"` — which settles nothing. The Skill does say the right thing at line 187
(*"The host does not rewrite KP-authored decision identities"*), 200 lines away
from the tool signature the KP is reading.

So the fix is not a contract change and not a host change. It is to make the
card self-explanatory at the point of use — say on `decision_id` and `revision`
themselves that the host has prefilled them and that they are to be passed
through unchanged. That is a model-facing text change, which is why it stays in
Class B.

**What the discarded hypothesis cost, recorded so the shape is recognisable.**
The wrong version was reached by reading the code path rather than the
evidence: a grep for prefilled `turn.finalize` cards used a pattern that only
matched the `next_operation` nesting used by `setup.complete`, returned zero,
and that zero was taken as proof the host never delivered the card. Three
layers of causation were then derived from it — `draft_contract_usable` going
false, the two gates dropping the card, and the recovery operation
(`state.recover_pending_narration_draft`, `kp_surface: none`) being
unreachable. Each layer is real code and each inference was locally valid. The
premise was not. **A confirmed error message beats a plausible code path**: the
20 `missing_param` bodies were available the whole time and name the two fields
outright.

**B2. Make the advertised tool list append-only within a player turn.**
*(saving: most of the remaining prefix churn after A1 — the 13 partial-miss
calls; risk: the KP sees affordances the current stage would reject)*
The set legitimately narrows and widens as the stage advances (`acting` →
`journaled` → `output_context_ready` → `review_ready`). If the *advertised* set
only ever grows within a turn and resets at the turn boundary, the prefix
becomes append-only inside a turn. `evaluateExecuteAcl` remains the authoritative
gate and `tool-working-set.ts` already documents visibility as "advisory and
fail-closed", so authority does not move — but the KP would see a wider menu than
the stage intends, and could waste calls on `stage_forbidden` rejections. That is
a real KP-behaviour trade and must be judged, not assumed. Validate against
`plugins/coc-keeper/pi/test/startup-tool-union.test.mjs` and the ACL tests.

**B3. Make the epoch fold actually fire.** *(measured saving: 17,549 tokens per
call once it fires — ~30% of a live-turn call; risk: the KP loses verbatim
closed-turn tool payloads)*
`pending_chars` peaked at 71,437 = 17,860 `estimateTokens`, against a threshold
of 20,000 — it missed by 10.7% and folded nothing all session. Either lower
`DEFAULT_FOLD_THRESHOLD_TOKENS`, or compare against a CJK-aware size instead of
`chars/4` (`context-probe.ts` already documents that the heuristic under-reads
Chinese). The mechanism is written, wired and byte-stable, and the stub tells the
KP how to re-read; but folding is by definition a change to what the KP can see,
so it belongs here. Note the structural limit from §5: the fold can never touch a
runaway turn, so B3 does not substitute for B1.

**B4. Stop resending full skill documents forever.** *(measured: 154,948 chars,
51% of all tool-result content — 97,910 chars in the play session alone; risk:
HIGH — this is the KP's craft guidance)*
`coc-keeper-play/SKILL.md` (38,684 chars), `coc-character/SKILL.md` (29,447),
the tooling-detail reference (23,407) and `coc-main/SKILL.md` (23,125) are read
once and then resent verbatim on every later model call for the life of the
process, while the system prompt already carries a 7,290 B `<available_skills>`
index pointing at them. Options run from "let B3's fold stub them like any other
closed-turn result" to "serve skill docs outside the transcript". Every option
changes what guidance sits in front of the KP. `plugins/coc-keeper/skills/**` is
also **shared kernel scope** and off-limits without explicit authorization.

**B5. Bound the closure-contract retry loop.** *(saving: caps the damage of a
B1-class failure; risk: silently suppressing a retry the KP would have won)*
A `nonretryable_repeat_blocked` verdict followed by two more failures of the same
operation is proof the KP cannot escape unaided; `lib/nonretry-circuit.ts` and
`lib/recovery-guidance.ts` are the right homes for a budget plus a recovery card.
This is containment, not a fix — and it takes retry latitude away from the KP,
which is a product decision, not a performance one.

**B6. Trim `scene.context`.** *(measured: at most 35,894 chars = 12% of
tool-result content, ~4% of a live-turn call; risk: removes forward-look the KP
uses)*
Listed last deliberately, with the number that justifies the ranking. On this
evidence it is **not worth the KP-behaviour risk** until A1, A2 and B2/B3 have
landed and the session has been re-measured.

### What NOT to do

- Do not chase the streaming-delta count. 22,249 `message_update` events are
  transport recording granularity and cost nothing in context.
- Do not reduce the working-set *size*. It is already ≤ 12 of 102 tools and
  ≤ 23 KB. Its *instability*, not its size, is the cost.
- Do not treat "the context window is filling up" as the problem. The peak
  single request was 96,630 of 500,000 tokens.
- Do not trim a projection first. On these numbers that is the smallest lever
  and the one with the most KP-behaviour risk per token saved.

---

## 9. Reproduction commands

```bash
cd /Users/haoli/leehow/code/chatrpgv4

# per-model-call provider usage, grouped by player prompt
python3 - <<'PY'
import json
p='.coc/playtests/dirgraph-smoke-20260901/rpc-events.jsonl'
cur=None; agg={}
for line in open(p):
    try: o=json.loads(line)
    except: continue
    if o.get('type')=='response' and o.get('command')=='prompt':
        cur=o['id']; agg.setdefault(cur, {'calls':0,'inp':0,'cr':0,'out':0})
    if o.get('type')=='message_end' and o['message'].get('role')=='assistant':
        u=o['message'].get('usage') or {}
        d=agg[cur]; d['calls']+=1
        for k,s in (('inp','input'),('cr','cacheRead'),('out','output')): d[k]+=u.get(s,0)
for k,v in agg.items(): print(k, v)
PY

# working-set churn vs cache outcome
python3 - <<'PY'
import json, statistics
p='.coc/playtests/dirgraph-smoke-20260901/rpc-events.jsonl'
ev=[]
for line in open(p):
    try: o=json.loads(line)
    except: continue
    t=o.get('type')
    if t=='entry_appended':
        e=o.get('entry') or {}
        if e.get('customType') in ('coc-tool-working-set','coc-tool-working-set-replan'):
            rev=(e.get('data') or {}).get('revision','')
            ev.append(('ws', rev.split(':tools-')[-1]))
    elif t=='message_end' and o['message'].get('role')=='assistant':
        u=o['message'].get('usage') or {}
        ev.append(('call', (u.get('input',0), u.get('cacheRead',0))))
    elif t=='driver_pi_exited':
        ev.append(('reset', None))
prev=None; changed=0; buckets={'HIT':[], 'partial':[], 'FULL-MISS':[]}
for kind, v in ev:
    if kind=='reset': prev=None
    elif kind=='ws':
        if v!=prev:
            if prev is not None: changed+=1
            prev=v
    else:
        inp, cr = v; ctx = inp+cr
        if ctx==0: changed=0; continue
        tag='FULL-MISS' if cr<2000 else ('partial' if cr<ctx*0.6 else 'HIT')
        buckets[tag].append(changed); changed=0
for tag, xs in buckets.items():
    print(f"{tag:<10} n={len(xs):>3} mean_ws_changes={statistics.mean(xs):.2f} zero_change={sum(1 for x in xs if x==0)}")
PY

# per-call transcript class breakdown + fold stats
python3 -c "
import json
recs=[json.loads(l) for l in open('.pi/coc-agent/telemetry/turns.jsonl') if l.strip()]
for r in recs[-6:]:
    if r.get('record')!='turn': continue
    print(r['seq'], repr(r.get('prompt_excerpt'))[:30], 'calls', r['model_calls'])
    print('  fold', r['context_fold'])
    for s in r['steps']:
        if s.get('kind')=='model' and s.get('context_probe'):
            c=s['context_probe']; print('   ', c['messages'], c['chars'], c['by_class'])
"

# exact system-prompt component bytes (uses pi's own builder)
cat > /tmp/pi-sysprompt.mjs <<'JS'
import { readFileSync } from "node:fs";
import { buildSystemPrompt } from "/Users/haoli/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js";
const R = "/Users/haoli/leehow/code/chatrpgv4";
const roles = JSON.parse(readFileSync(`${R}/plugins/coc-keeper/pi/session-roles.json`, "utf8"));
const B = (s) => Buffer.byteLength(s, "utf8");
const fm = (p) => { const t = readFileSync(p, "utf8"); const b = /^---\n([\s\S]*?)\n---/.exec(t)?.[1] ?? "";
  return { name: /^name:\s*(.*)$/m.exec(b)?.[1] ?? "",
           description: /^description:\s*([\s\S]*?)(?=\n[a-z_]+:|$)/m.exec(b)?.[1]?.trim() ?? "", filePath: p }; };
for (const role of ["setup", "play"]) {
  const skills = roles[role].skills.map((s) => fm(`${R}/${s}/SKILL.md`));
  const append = readFileSync(`${R}/${roles[role].prompt}`, "utf8");
  // cwd must be the run's sandbox: the skeleton embeds "Current working directory: <cwd>"
  const o = { selectedTools: ["read"], toolSnippets: { read: "x" },
              cwd: `${R}/.coc/playtests/dirgraph-smoke-20260901/sandbox`,
              skills, contextFiles: [], appendSystemPrompt: append };
  console.log(role, "system prompt bytes", B(buildSystemPrompt(o)),
    "| skills index", B(buildSystemPrompt(o)) - B(buildSystemPrompt({ ...o, skills: [] })),
    "| role prompt", B(append));
}
JS
node /tmp/pi-sysprompt.mjs
# -> setup system prompt bytes 31007 | skills index 3920 | role prompt 25356
# -> play  system prompt bytes 59781 | skills index 7290 | role prompt 50760
```

Note the launcher passes `--no-context-files`
(`plugins/coc-keeper/pi/bin/pi-coc:483-492`), which is why `contextFiles: []`
above is the faithful reconstruction and `AGENTS.md` is **not** in the prefix.

---

## 10. Implementation status — Class A, 2026-09-01

- `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`. Codex-host implementation, adapters,
  prompts, launchers, tests, and documentation stayed off-limits.
- Scope: **A1 and A2 only.** B1–B6 are not implemented and nothing
  model-facing changed. No file under `.coc/` was written or deleted; the
  session evidence was read only.
- No `pi-coc` session was launched. Everything below is either offline
  measurement over the preserved `dirgraph-smoke-20260901` evidence or a unit
  test.

### 10a. A1 does not exist. The flickers were an artifact of §3d's own script.

**A1 was written on a phantom and cannot be implemented, because the
phenomenon it targets never happened.** This is the same failure shape as the
B1 correction, from the same cause: a derived number was trusted without
checking the raw record it came from.

The §3d churn script feeds two different entry types into one timeline:

```python
if e.get('customType') in ('coc-tool-working-set','coc-tool-working-set-replan'):
    rev=(e.get('data') or {}).get('revision','')
    ev.append(('ws', rev.split(':tools-')[-1]))
```

`coc-tool-working-set-replan` entries **have no `revision` field**. Their
payload is `{status, reason, tool_name, stage, player_turn_epoch,
canonical_progress_revision, before, after}` — the working-set revision they
carry lives at `data.after.working_set_revision`, not `data.revision`. So
`rev` is `""`, `"".split(':tools-')[-1]` is `""`, and every one of the 26
replan entries enters the timeline as a **phantom empty tool list**, then
"restores" on the next real audit entry. Each one costs two spurious
transitions.

That single mismatch produces every A1 number:

| §3d / A1 claim | what the evidence says |
| --- | --- |
| "the advertised tool list changed **78** times" | 78 reproduces exactly with the buggy script. Excluding replan entries: **31** publication-level transitions |
| "**27** transient working sets of exactly **1 tool / 0 schema bytes**" | 26 replan entries (each carries exactly one `tool_name` and no `schema_bytes` field) + 1 genuine empty set = 27. **Audited publications with exactly 1 tool: 0** |
| "`WS#1` 13 tools → `WS#2` 1 tool → `WS#3` the same 13 tools, within 3 event lines" | event lines 98 (13 tools), **99 = a replan entry**, 101 (13 tools). The "3 event lines" is the replan entry sitting between two audits |

Checked directly, and all three came back negative:

- publications whose tool list is **empty**: **1** in the whole session;
- publications with **exactly one** tool: **0**;
- changes that are the **same set in a different order**: **0**;
- changes where the names held still and only a **schema** moved: **0**.

The one genuine empty publication is not a flicker either. It is line 4745,
stage `delivered`, `tools-none` — published *after* `message_start` (4559) and
*before* `message_end` (4746) of the final delivery call, i.e. inside a
streaming window, then replaced by the next turn's 8-tool set at line 4761
before any further request. It never reached a provider request. It is worth
recording as a **latent** hazard — had a call started while it was in force,
the provider would have seen a zero-tool list and a total prefix wipe — but
suppressing it would change what the KP is advertised, so it is not Class A
and it cost nothing here.

**There was also never anything to save by de-duplicating publications.** 120
of the 151 audited publications re-publish the set already in force, but a
publication only reaches the provider if a model call is built after it. Of
the 31 publication-level transitions, **22** fell between two consecutive
model calls; the rest were absorbed. The redundant publications were already
free.

So `applyKpActiveTools` was **not** changed, and no publication guard was
added. A guard would have been a placebo: measurable in the audit-log line
count and worth exactly zero tokens.

**What survives, and is stronger than the report claimed.** Recomputed with
replan entries removed and each call attributed to the tool list in force when
its request was built:

| cache outcome | calls | calls with **zero** tool-list change before them | mean changes |
| --- | ---: | ---: | ---: |
| HIT (`cacheRead ≥ 60%` of ctx) | 28 | **25** | 0.18 |
| partial | 13 | **1** | 1.23 |
| full miss | 11 | 4 (3 are process starts) | 0.73 |

The diagnosis in §0 and §6 — prefix churn from a mutating `tools` field is the
biggest line item — is unaffected. What is refuted is that any of that churn
was free to remove. All 22 provider-visible changes are genuine membership
changes tracking the stage machine (`acting` → `journaled` →
`output_context_ready` → `review_ready`), plus two real within-turn
oscillations worth naming because they are the strongest remaining lever:

- `coc_rules_settle` added at line 21247, removed at 21338, re-added at 21408,
  removed at 21513 — four prefix rewrites inside one player turn;
- `coc_narration_review` removed at 21695, re-added at 21703, removed at
  21806, re-added at 21969 — four more.

Both are **B2**, not A1: eliminating either means advertising a tool the
current stage would reject, which changes what the KP sees.

### 10b. A2 implemented — the request body is now measured.

New: `plugins/coc-keeper/pi/lib/request-prefix-probe.ts`, wired into
`lib/turn-telemetry.ts` on pi's `before_provider_request` event.

The report's A2 asked for `tools_revision` / `tools_bytes` /
`tools_names_hash` / message count on the telemetry step, and for the
`coc-tool-working-set` entry to be emitted before the first model call. The
first half is implemented and then some. **The second half was deliberately
not done**, and the reason matters: moving when `applyKpActiveTools` publishes
is not observation — it changes when the KP's tool list is set — so it would
not have been Class A. The request probe gets the same fact more directly and
more truthfully: it records the tool list **the provider actually received**
on every call including the first, rather than the list the extension intended
to publish.

`before_provider_request` carries the fully assembled provider params — pi-ai
calls `onPayload(params, model)` in `api/openai-responses.js:100` immediately
before `client.responses.create(params)`. That object is the only place the
whole prefix exists at once. Recorded per model call, onto the existing
`ModelCallStep` as `request_prefix` (telemetry schema **v5 → v6**):

| field | closes |
| --- | --- |
| `instructions_bytes` / `instructions_digest` / `instructions_status` | §7.1 — the system prompt as received, not reconstructed from `session-roles.json` |
| `tools_count` / `tools_bytes` / `tools[]` (per-tool bytes) / `tool_names` | §7.1 — including the first call of a session, which the audit entry structurally cannot cover |
| `tools_status` (`first`/`stable`/`changed`) | §7.2 — sits on the same step as that call's `usage`, so "tools moved ⇒ cache missed" stops being a correlation across two files |
| `tool_names_digest` vs `tools_digest` | separates a membership change from a reschema of the same names |
| `input_messages` / `input_bytes` | the transcript actually sent, post-fold |
| `other_bytes` | §7.1 — the residual (model id, sampling, reasoning config, `tool_choice`, cache directives). This is the bucket the ~18k unattributed prefix tokens have to come out of |

Per-turn roll-up `request_prefix` on the turn record carries
`tools_changed_calls` next to the existing `tokens.input` / `tokens.cache_read`.

Three properties keep it an observation, and all three are asserted by tests:

1. **It returns nothing.** A `before_provider_request` handler that returns a
   value *replaces* the provider payload
   (`extensions/runner.js:790` — `if (handlerResult !== undefined)
   currentPayload = handlerResult`). The handler is a block body with no
   return, and the smoke asserts both that the returned value is `undefined`
   and that the payload serializes byte-identically after the call.
2. **It copies nothing.** Byte counts, tool names, and digests only. The tests
   assert no prompt text, message content, or schema body appears anywhere in
   the recorded step.
3. **It cannot throw.** Unserializable, circular, `null`, and unrecognised
   bodies all yield `null`.

Kill switch `PI_COC_REQUEST_PREFIX_PROBE=off|0|false`, default on, mirroring
`PI_COC_CONTEXT_FOLD`. Output goes to `<agentDir>/telemetry/turns.jsonl` and
to the operator-only `/timing` panel. **Nothing reaches the model.**

Also corrected, as A2 asked: the `lib/context-probe.ts` docstring that claimed
its sizes "track what the provider is actually billed for". They track the
message array, which is one of four sections of a request; the corrected text
carries the two measurements that show the gap (180 `est_tokens` vs 33,000
billed on the first play call; 39,967 vs 58,191 mid-turn) and points at the
new module.

### 10c. What is proved offline, and what is not

**Proved by test** (`tests/pi/request-prefix-probe.mjs`,
`tests/pi/turn-telemetry-smoke.mjs`, both wired into
`tests/test_pi_package.py`): the probe measures all four sections and they
reconcile with the serialized body; an append-only transcript reads `stable`
while a moved `tools` field reads `changed` on the same pair of calls; a
reschema is separable from a rename; `openai-responses`, `anthropic-messages`,
legacy `function` nesting, and an unrecognised shape all behave; the payload is
not mutated; no content is copied; the kill switch works.

**Proved by measurement over preserved evidence** (§10a): every A1 number, and
the corrected churn/cache table.

**Not proved, and not provable offline:**

- **That A2's numbers will close §7.1.** The probe records what it is given;
  whether `instructions + tools + input + other` accounts for all 33,000
  tokens of the play prefix is only answerable from a run. It could still come
  up short — if it does, the residual is in the provider's own rendering, and
  `other_bytes` is where that will show.
- **Any cache saving.** A1 saved nothing because there was nothing to save;
  A2 saves nothing by design. This branch does not reduce token cost, and no
  claim that it does should be read into it.
- **§7.2's causal question.** The probe makes it answerable in one run; it
  does not answer it now.

**A live run would settle both, and it is not started here.** It needs the
user's go-ahead, it is a real `pi-coc --mode rpc` session with a live model one
player line at a time (never a scripted KP), and the xAI OAuth token expires
roughly every 6 hours. Ten player turns is enough; the probe is on by default,
so nothing beyond launching it is required.

### 10d. Verification

`scripts/verify_against_baseline.py` against this branch's pre-change `HEAD`
(both prior commits are documentation only, so `HEAD` is the true pre-change
code baseline), targeting `tests/test_pi_package.py`,
`tests/test_python_contract.py`, `tests/test_inventory.py`,
`tests/test_operation_module_architecture.py`,
`tests/test_runtime_pi_adapter_contract.py`.

```json
{"verdict": "clean",
 "counts": {"failing_here": 71, "failing_on_baseline": 71, "regressions": 0,
            "baseline_only": 0, "failures_in_new_tests": 0}}
```

71 failures on both sides, identical sets, and both new pytest functions are
outside them.

**The content diff needed a correction to be readable.** Run with the content
pass on, the tool reported ~50 `masked_new_violations`. Every one of them is a
tree-root artifact, not a violation: `_named_paths` compares path *strings*,
and this tree's absolute paths (`/Users/haoli/leehow/code/chatrpgv4-wt-context-growth-20260901/...`)
can never equal the baseline worktree's (`/private/var/folders/.../baseline/...`),
so every absolute path in a traceback reads as new. Re-run with both trees'
roots stripped and pytest tmpdirs normalized, the masked set is **empty**:

```
normalized_masked_new_paths: []   # 0
```

None of the seven files this branch touches appeared in the raw list either.
The tool itself is not modified here — it lives on another branch — but the
absolute-path false positive is worth knowing before the next reader trusts
that field.

Pre-existing failure worth flagging, **not caused by this work and not
fixed here**: `test_pi_turn_telemetry_logs_fine_grained_step_timing_for_offline_analysis`
is red on `toolStepDetail` — the smoke expects `wrapper_tool == "coc_rules"`
for a `coc_invoke` / `rules.roll` call and `classifyToolCall` returns
`"coc_invoke"`. It fails identically on the baseline.

That failure is also why the new request-prefix assertions live in their own
pytest function rather than being appended to that one: assertions after a
failed assert never execute, so appending them there would have produced
coverage that looks real and runs never — the same class of blind spot
`docs/repository-health/verifying-against-a-baseline.md` was written about.
