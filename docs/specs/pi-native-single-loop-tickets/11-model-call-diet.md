Status: ready-for-human
Stage: SL-11 (with SL-10; before SL-03)
Spec: docs/specs/pi-native-single-loop.md (Rulings: "A turn is under 60 seconds")

# SL-11 — The model-call diet: fewer calls, fewer output tokens per call

## Evidence (the SL-02 live gate, 2026-09-23, session d33d44c1, campaign game-b5367f88)

Per call of the declared-move turn (Grok 4.7 Fast, `reasoning_effort: low`, measured 90–115 output tokens/s):

| call | s | output tok | reasoning tok | what |
| --- | --- | --- | --- | --- |
| 1 | 10.9 | 1077 | 989 | two `lookup`s (module + source) — cache read 17.5K of 42K, TTFT 5.5 s |
| 2 | 2.2 | 32 | 22 | `look clues` |
| 3 | 22.6 | 2586 | 1322 | one `apply` batch with paragraph-long `how`/`why` |
| 4 | 4.1 | 225 | 209 | `look npc` |
| 5 | 6.3 | 484 | 427 | `apply person` |
| 6 | 2.9 | 117 | 4 | `resolve` first impression |
| 7 | 12.2 | 1069 | 646 | the narration (377 chars) |

Three of seven calls were reads the host could have supplied; reasoning alone was ~3.6K tokens (~35 s).

## Scope

1. **The read step supplies what the model looks up:** for every issued scene candidate (clue, handout, person) the read artifact carries the body/description the Keeper would otherwise `lookup`/`look` for (bounded per candidate, the same 1 KB-class budgets the capsule uses; cite §13.2/§131); measure on the gate table's session which lookups it would have removed.
2. **Tool arguments are not prose:** contract + tool schema + prompt: `how`/`why` one sentence (schema `maxLength`, refused with a `fix` that says shorten, not a silent cut); `apply` batches over one-call-per-effect (the prompt already prefers batches — check why the Keeper split them and fix the cause, not the wording).
3. **Reasoning budget by provider option, measured:** probe the Grok Build provider's reasoning options (`reasoning_effort` values the API accepts; any "minimal"/"none"; the existing thinking-schedule code in `tests/extension/thinking-schedule.test.mjs` and `runtime/`), run the turn-3 and fight-round replays at each accepted level with the product driver, and report tokens and seconds per call and whether actions still match 8/8. Do not change the default without the numbers; the owner picks from the table.
4. **Cache prefix:** the first call of a turn read only 17.5K cached of 42K; find what the read step changes before the stable prefix (prescreen material placement, §128.1 `context_with_system`) and move the per-turn material after the stable prefix; measure cacheRead before/after on the replay.

## Acceptance

- Replays (turn-3, fight-round; product driver; 3 runs each): calls per turn, output/reasoning tokens per call, wall, cacheRead on the first call, all before/after, in a table; 8/8 actions kept.
- Tests: the read artifact carries candidate bodies (mutation: bodies dropped → a test on the artifact fails); `how`/`why` over the limit refused with the fix; the prefix test (a run's second call reads the first call's prefix from cache in the fake provider's accounting).
- `npm run test:ext`, pytest green on the branch baseline; legacy prompt/tool behaviour unchanged except the argument limits (which apply to both engines — say so in the contract).

## Comments

### 2026-09-23: implemented on `claude/sl11-model-call-diet-20260923`

Branched from `dd7aebb32`. 0.9.5a was merged in at `08fb1377a`.

**Commits**

| commit | what |
| --- | --- |
| `5a5c3ee6a` | contract §135.20–§135.24, committed before the code |
| `8332db389` | §135.20: bodies on the read, in `runtime/jev/candidate-bodies.ts` and `runtime/jev/hybrid-engine.ts`, plus the `ReadResult.bodies` type |
| `c80da92da` | §135.21: one-sentence `how`/`why`, in `extensions/kernel/tools.ts`, the registration in `index.ts`, and the canonical dispatcher |
| `9c35d6905` | §135.23: an append-only turn request, in `extensions/table/context-runtime.ts` and `context-policy.ts`, plus the SL-11 tests |
| `e76f96e81` | the harness's live-Keeper mode |
| `f425afb04` | the dispatcher and brief tests, plus the fake kernel's `FAKE_KERNEL_STYLE_BUDGET` |
| `5b40f2d12` | README |
| `08fb1377a` | merge of 0.9.5a |
| this commit | the ticket, the manifest, and the measurement scripts, results and gate fixture |

**Contract.** SL-11 takes §135.20–§135.24.

- **§135.20:** the read hands the Keeper the bodies of what it issued.
- **§135.21:** a tool argument that explains a write is one sentence. This applies to both engines, and it is the
  only legacy-visible change.
- **§135.22:** why a batch split, and the cause fixed.
- **§135.23:** a turn's request is append-only.
- **§135.24:** the reasoning-level probe.

§135.11–§135.19 are left to the SL-02 follow-ups on the same base, and §135.11 is the prose-delivery fix's. Nothing
was renumbered.

**The instrument.** `experiments/single-loop-routing/product-entry.ts` gained a live-Keeper mode:

```
--keeper live --thinking <level> [--then "<next input>"]
```

- It runs the real `grok-build/grok-4.7-build-fast` on the product driver. The login is the App's grok-build
  credential, copied into the disposable workspace without its refresh token, so nothing it does can rotate the
  App's login.
- Each run's summary adds `model_calls`: the provider's own `input`, `cache_read`, `output` and `reasoning` tokens
  per call, its seconds and time to headers, its tools, and the effort sent. The trace adds each provider payload's
  shape, item by item (kind, bytes, digest).
- With a live Keeper, an admission review that has no recorded verdict is answered `authorized`. Every recorded
  verdict of both fixtures is authorized or entailed, and admission is SL-10's to measure.
- This is a measurement on disposable copies, not a table and not a playtest.
- The results are under `experiments/single-loop-routing/results/sl11-*`.

#### Scope 1: which of the gate turn's reads the bodies remove

**Script:** `experiments/single-loop-routing/sl11-measure-lookups.mjs`. It runs over `fixtures/gate-turn1`, a byte
copy of `game-b5367f88` before turn 1, on the emitted kernel. The read step's builder and bodies run exactly as the
product runs them. Each recorded Keeper read is re-issued with its recorded parameters, and its answer is compared
with the bodies, string by string.

| gate call | recorded read | carried by the bodies |
| --- | --- | --- |
| 1 | `lookup module "knott-keys knott-commission knott-research-leads Handout 1"` | The recorded mixed query returned `not_found`. Per handle, 100%: knott-keys 4/4, knott-commission 6/6, knott-research-leads 6/6, Handout 1 9/9 strings. |
| 1 | `lookup source "Steven Knott commission"` | The call was refused (no source document). The terms it asked for ($20 a day, the keys, the address) are in the knott-keys and knott-commission bodies. |
| 2 | `look clues` | 13/14 strings. The fourteenth is a clue's `name`, which the body entry carries. |
| 4 | `look npc Arty Wilmot`, after the Keeper's own move | The read after that scene change carries Arty's and Ruth's person bodies: the whole dossier (untold, role, wants, fears, hides, voice, keeper note). The 10 strings missing are `social_role` and combat fields, cut to 1 KiB and named in `omitted_fields`. |

At turn start the read issued 5 bodies: 3,087 B, 5 kernel reads, 42 ms. After the move it issued 12: 7,647 B, 17
kernel reads, 67 ms. All three read calls of the turn (four `look`/`lookup` requests) are covered by content.

**Live, on the same turn** (product driver, live Keeper, `low`, 3 runs each arm):

| | before | after |
| --- | --- | --- |
| calls on the gate turn | 7 / 5 / 8 | 5 / 6 / 4 |
| read-only calls | 3 / 1 / 1 | 0 / 0 / 0 |
| calls containing a `look`/`lookup` | 3 / 2 / 1 | 1 / 0 / 0 |
| `apply` calls | 2 / 2 / 6 | 3 / 3 / 3 |

The development run of the base code had 3 read-only calls in 7.

On turn 3, where the clerk moves before the Keeper's first call, `look npc Arty Wilmot` still appears in 1 of 3 runs
at `low` and in 2 of 3 at `medium`. A `look object` for the 1918 handout's text appears in 1 of 3 at `low`. The
handout's text has no kernel read before it is shown (§133): its body carries the summary and when to deliver it,
not the words.

#### Scope 2: how/why, and why the batches split

**The limit.** `how` and every `why` declare `maxLength` 200.

- A longer one is refused before anything runs with `invalid_params` / `argument_too_long`. The fix begins
  "Shorten effects[i].why to one sentence of at most 200 characters and send the same call again; nothing in this
  call was written."
- This holds on both engines, and for a policy-origin call through the dispatcher.
- Nothing is cut.

**The ticket's premise is corrected.**

- 604 recorded `how`/`why` arguments were measured: 354 from the App's 47 play sessions and 250 from the source
  tree's 297. The longest is 99 characters, and the Chinese p99 is 53. The ceiling refuses none of them.
- The gate's 2,586-token call 3 was one batch of nine effects. Its `how`/`why` were 13–30 characters each. The
  tokens were 1,322 of reasoning plus about 1,260 of arguments, not paragraphs.

**Why the Keeper split (§135.22), from its own reasoning on the gate.**

- Call 4 was a look, because the destination's people reached it only in the move's result ("I don't have their
  appearance from the capsule. I should look at NPCs...").
- Call 5 staged Arty.
- Call 6 was the first impression.
- The other splits follow dice: Persuade after the first impression, and Ruth after Arty relents.

**The fix of the cause.** A move candidate's body carries `people_there`, and a person candidate carries its look.
The prompt is not reworded. On the live gate turn the Keeper's first call became a batch in 3 of 3 runs, with
2,044–2,922 output tokens where the base run's first call was lookups. The long run of separate `apply` calls
(6 in the base's run 3) did not recur.

#### Scope 3: reasoning levels

**What the API accepts.** `grok-4.7-build-fast`, Responses API, the App's credential, 2 passes each. Script:
`sl11-effort-probe.mjs`.

| `reasoning.effort` sent | HTTP | served as | reasoning tokens (toy prompt) | s |
| --- | --- | --- | --- | --- |
| omitted | 200 | **high** | 173 / 133 | 3.6 / 1.9 |
| `none` | 400 | "This model does not support `reasoning_effort` value `none`" | | |
| `off` | 400 | "Invalid reasoning effort" | | |
| `minimal` | 200 | low | 159 / 150 | 1.8 / 1.8 |
| `low` | 200 | low | 129 / 125 | 1.8 / 1.6 |
| `medium` | 200 | medium | 113 / 134 | 1.5 / 1.7 |
| `high` | 200 | high | 195 / 224 | 2.2 / 2.5 |
| `xhigh` | 200 | xhigh | 179 / 164 | 2.1 / 1.9 |
| `max` | 400 | "Invalid reasoning effort" | | |

- There is no thinking-off option for this model.
- The account catalog lists low, medium, high and xhigh, so Pi clamps `off` and `minimal` to `low`.
- Omitting the field serves `high`.
- `extensions/thinking-schedule` is not in `COC_EXTENSIONS`. Every launch passes `--no-extensions` with an
  explicit `-e` list, so it does not run at a table. On this model its `off` would land on `low` anyway.

**Per level on the product driver** (after the SL-11 changes, live Keeper, 3 runs each). `actions` is matched
against the recorded live turn, using SL-02's grouping for turn 3.

The two recorded turns were long ones. On turn 3, 10 of 15 live runs stopped after the first impression and handed
back to the player: no Persuade, no Ruth, no clippings. That is a legitimate Keeper choice, and it is what the 3/8
rows are. On the fight round, the NPC's recorded counter-attack was never repeated, in any arm or level.

**Turn 3** (`fixtures/turn3`)

| arm | runs | calls/turn | output tok/call | reasoning tok/call | s/call median (range) | model s/turn | wall s | first-call cacheRead/prompt | actions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before, low | 3 | 2/2/4 | 761 | 481 | 10.0 (4.4–16.2) | 20/28/26 | 46/44/41 | 0/45312 1152/44902 0/44899 | 3/8 4/8 3/8 |
| after, low | 3 | 6/2/4 | 791 | 541 | 9.5 (3.5–66.4) | 60/25/82 | 76/38/103 | 0/46821 0/46821 0/46818 | 8/8 3/8 3/8 |
| after, medium | 3 | 8/7/5 | 1585 | 1358 | 15.4 (3.3–40.2) | 123/114/87 | 149/129/95 | 1152/46820 1152/46821 1152/46822 | 8/8 8/8 3/8 |
| after, high | 3 | 5/7/5 | 2761 | 2506 | 23.6 (3.2–47.2) | 125/205/120 | 136/216/128 | 1152/47753 1152/47913 1152/46819 | 3/8 8/8 3/8 |
| after, xhigh | 3 | 9/4/5 | 2893 | 2693 | 32.1 (4.9–59.4) | 227/178/133 | 247/190/142 | 0/46823 0/46823 1152/46823 | 8/8 3/8 3/8 |

**Fight round** (`fixtures/fight-round`)

| arm | runs | calls/turn | output tok/call | reasoning tok/call | s/call median (range) | model s/turn | wall s | first-call cacheRead/prompt | actions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before, low | 3 | 6/1/4 | 338 | 250 | 4.5 (2.0–7.1) | 24/7/20 | 49/19/36 | 0/44543 1152/44543 1152/44543 | 2/3 2/3 2/3 |
| after, low | 3 | 5/5/5 | 305 | 201 | 3.7 (2.1–7.6) | 20/22/20 | 33/34/35 | 1152/45096 0/45097 0/45103 | 2/3 2/3 2/3 |
| after, medium | 3 | 7/7/5 | 799 | 695 | 9.2 (2.0–25.1) | 56/60/60 | 78/82/77 | 0/45050 1152/45044 0/45046 | 2/3 2/3 2/3 |
| after, high | 3 | 3/7/7 | 1776 | 1658 | 14.8 (3.1–56.2) | 55/127/125 | 71/140/134 | 1152/46605 1152/46589 1152/46587 | 2/3 2/3 2/3 |
| after, xhigh | 3 | 7/8/7 | 1312 | 1214 | 14.2 (2.4–25.1) | 89/142/91 | 100/151/100 | 1152/45094 0/45098 1152/45100 | 2/3 2/3 2/3 |

**The gate turn and its next input** (`fixtures/gate-turn1` with `--then`; `wall s` is the whole two-turn run)

| arm | runs | calls/turn | output tok/call | reasoning tok/call | s/call median (range) | model s/turn | wall s | first-call cacheRead/prompt | actions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before, low, gate turn | 3 | 7/5/8 | 675 | 357 | 6.3 (1.9–18.6) | 55/44/48 | 97/86/99 | 0/41838 0/41837 0/41837 | 0/0 0/0 0/0 |
| after, low, gate turn | 3 | 5/6/4 | 1007 | 544 | 9.1 (3.4–60.6) | 102/51/63 | 158/106/153 | 0/43445 1152/43444 0/43444 | 0/0 0/0 0/0 |
| before, low, next turn | 3 | 5/6/4 | 545 | 337 | 3.9 (1.3–28.4) | 24/29/43 | 97/86/99 | 16384/43411 16384/43040 16384/42369 | 0/0 0/0 0/0 |
| after, low, next turn | 3 | 5/3/6 | 628 | 428 | 6.1 (2.2–20.9) | 22/23/60 | 158/106/153 | 32768/45656 8192/43704 32768/45435 | 0/0 0/0 0/0 |

**The owner picks; the default is unchanged (`low`).**

- **Per call.** Reasoning tokens roughly double per level: turn 3 goes 541 → 1,358 → 2,506 → 2,693, and the fight
  round 201 → 695 → 1,658 → 1,214. The median seconds per call follow: turn 3 goes 9.5 → 15.4 → 23.6 → 32.1 s.
- **Calls per turn.** At `medium` and above, the Keeper makes more calls per turn. Model time per turn at `medium`
  is 87–123 s on turn 3 and 56–60 s on the fight round, against 25–82 s and 20–22 s at `low`.
- **Actions.** The full recorded sequence (8/8) occurred in 1/3 runs at low, 2/3 at medium, 1/3 at high and 1/3 at
  xhigh.
- **Conclusion.** No level above `low` fits the 60-second ruling on these turns.

#### Scope 4: the cache prefix

**What changed before the stable prefix.** Measured on the provider payloads of the two-turn gate replay, item by
item:

- `instructions` is empty. Item 0 (the system prompt) and the tools are byte-stable, so neither §128.1 nor the
  prescreen's slot was the break.
- Item 1 is the brief. It flipped at every turn start (43,811 B against 42,947 B), because `briefForTurn` sent the
  part of the full style that the fresh turn capsule lacked. So the first call of a turn read only the system
  prompt: 16,384 of about 43K tokens, 3/3.
- Item 4 is the capsule. It was re-rendered after every write, so within a turn the cache stopped there.

**The fix (hybrid only).**

- The source's own brief.
- The capsule and the run packet as the turn's first request sent them.
- Changes at the end, as `coc-capsule-update` and a later packet.

| measure | before | after |
| --- | --- | --- |
| next turn's first call, provider `cacheRead` (gate, `low`) | 16,384 / 16,384 / 16,384 of ~43K | 32,768 / 8,192 / 32,768 of ~45K |
| prompt bytes a call shares with the previous call: at a turn boundary (payload shapes) | 22–24% (system only) | 45–47% (through the brief) |
| the same, within a turn after a write (payload shapes) | 55–68%: diverges at the capsule | 84–100%: diverges only at the tail |
| recorded-Keeper replay, faux accounting, uncached input per later call | turn 3: 7.3–9.5K; fight: 8.8–9.6K tokens | turn 3: 3.0–4.3K; fight: 2.4K tokens |
| recorded-Keeper replay, second call's `cacheRead` against the first call's prompt | 36,550 of 43,490 | 46,092 of 46,092 (turn 3); 44,781 of 44,781 (fight) |

- The server's `cacheRead` is block-granular and noisy. Identical prefixes sometimes read 0 or 1,152, in both
  arms. The payload shapes and the faux accounting are the deterministic measure.
- The first call of a single-turn replay is always cold. Each run is its own session (`prompt_cache_key`), so that
  column reads 0 or 1,152 in every arm. Only the two-turn gate replay measures a turn's first call.

#### Replays with the recorded Keeper (faux; the 8/8 check)

| fixture | arm | runs | live actions | LLM steps | uncached input, calls 2+ (tokens) | wall |
| --- | --- | --- | --- | --- | --- | --- |
| turn3 | before | 3 | 8/8 ×3 | 5 ×3 | 7,344–9,534 | 11.0–18.5 s |
| turn3 | after | 3 | 8/8 ×3 | 5 ×3 | 2,956–4,253 | 10.8–15.7 s |
| fight-round | before | 3 | 3/3 ×3 | 2 ×3 | 8,846–9,626 | 6.4–7.8 s |
| fight-round | after | 3 | 3/3 ×3 | 2 ×3 | 2,442–2,443 | 6.4–8.3 s |

The first call's prompt grows by 2.6K tokens on turn 3 and 0.6K on the fight round: the bodies, plus the full style
in the brief.

#### Acceptance

**Tests.** `tests/extension/single-loop-model-call-diet.test.mjs` has 11 tests:

- bodies from the kernel reads, with the budget and the marks;
- the read artifact and the Keeper packet carry the bodies;
- over-limit `how`/`why` is refused with the fix: pure, on the legacy engine, on the hybrid engine, and through the
  dispatcher;
- the prefix test: a run's second call's faux `cacheRead` is at least the first call's whole prompt, and the next
  turn's first call shares everything through the brief;
- the brief is stable on hybrid and is still the residue on legacy.

**Mutations**, each applied, the file run, then restored. All 10 were killed:

| mutation | file | killed | tests that failed |
| --- | --- | --- | --- |
| M1 bodies dropped from the read artifact | `hybrid-engine.ts` | yes | 1 |
| M2 bodies kept off the Keeper packet | `hybrid-engine.ts` | yes | 1 |
| M3 move body without the people there | `candidate-bodies.ts` | yes | 2 |
| M4 over-long how/why not refused (registration) | `kernel/index.ts` | yes | 2 |
| M5 refusal helper silent | `kernel/tools.ts` | yes | 4 |
| M6 schema without maxLength | `kernel/tools.ts` | yes | 1 |
| M7 dispatcher does not check | `canonical-operation-dispatcher.ts` | yes | 1 |
| M8 capsule re-rendered in place | `context-runtime.ts` | yes | 1 |
| M9 brief is the per-turn residue again | `context-runtime.ts` | yes | 1 |
| M10 capsule update not sent | `context-runtime.ts` | yes | 1 |

M9 first survived. On the real-kernel test campaign, the turn capsule's style fits its budget, so there was nothing
to flip. It is killed by the fake kernel's `FAKE_KERNEL_STYLE_BUDGET` test, where the rehydrated capsule carries
more style than a turn capsule, as the gate's did.

**Counts** (merged state `08fb1377a`):

| suite | branch baseline `dd7aebb32` | merged state `08fb1377a` |
| --- | --- | --- |
| `npm run build:runtime` | exit 0 | exit 0 |
| `npm run test:ext` | 2730 tests. Under a concurrent replay's load, 4 load-sensitive tests failed (card patch, two Jev source-domain tests, NPC preparation overlap); their 3 files re-run alone: 17/17. | 2758/2758 |
| `uv run --frozen python -m pytest tests/kernel tests/play` | 1688 passed, 1 skipped (lead's figure) | 1691 passed, 1 skipped, exit 0 |

On the merged state, `test:ext` is the merged base plus the 11 SL-11 tests. The coordinator gave the merged base as
2746; 2758 − 11 = 2747, so the base is one test higher than that figure. The base was not re-run separately.

#### Observations, not fixed here

- **The scratch gate fixture.** Like `fixture.mjs --make`, it copies the whole campaign directory. After the reset to
  turn 1, later turns' untracked stores (`memory/`, `npc/`, `npc-voice/`, …) remain, so the next turn's writes hit
  `idempotency_conflict` in both arms. Only that turn's first call is used.
- **Provider stalls.** A 60.6 s call with 357 output tokens and a 66.4 s one with 853 had normal time to headers.
  Model seconds per turn are noisy on the live arms. Medians are given.
- **The recorded turns are long.** The live Keeper's choices vary from run to run, so calls per turn with a live
  Keeper mix "fewer calls for the same work" with "less work this turn". The per-run actions column is the control.
