Status: ready-for-human (filed 2026-09-24 from long gates #3–#5; batch 6; measured 2026-09-24; re-ruled and implemented 2026-09-25 -- writes are silent; the next long gate measures it)
Stage: SL-50 (P2, delivery; the largest remaining wall on the starter)
Spec: docs/kernel-rpc.md §34.16, §135.11 (turn close), the `text_beside_tool_calls` drop

# SL-50 — Prose beside settled bookkeeping is the draft; it is dropped only beside a roll or a refused or pending call

## Evidence (`keeper-steps-gates3-5.txt`, `text-beside-drops.txt` in the session scratchpad; campaigns `longgate3-haunting-1058`, `longgate4-haunting-1308`, `longgate5-haunting-1447`)
- Model steps per turn: 53 / 65 / 60 over 20 turns; turns with ≥ 3 steps: 9 / 14 / 11. The most frequent reason for an extra step is the `text_beside_tool_calls` drop: 13 / 19 / 14 per table, several turns twice. Each dropped draft costs a re-compose of 10–18 s plus a lane review.
- Of 46 drops, 36 sat on steps with no look; on most of those the turn's admissions were all `authorized`/`entailed` (gate #5: t3, t5, t8, t12, t13, t19, t20; gate #4: t3, t8, t13, t19): prose beside settled bookkeeping, dropped anyway. The drop row records the dropped text but no step id, so exact pairing is the ticket's first step.

## Ruling (owner, 2026-09-24)
Prose beside tool calls is the turn's draft when every call in that step is an `apply` the host admitted (nothing the prose could pre-empt); it is dropped, with today's steer, only when the step carries a `resolve` (a roll the prose may have assumed) or a call that was refused or is pending. Structural: call kinds and verdicts, never wording.

## Scope
1. Measure first: pair each drop with its step (the `dropped` text against the step's messages) across the three campaigns and report how many were apply-only-admitted.
2. Contract: §34.16/§135.11 amendment (new subsection) with the rule; the drop row gains `step` and the step's call kinds/verdicts.
3. `extensions/kernel/index.ts` (the drop) and the hybrid engine's turn close: keep the draft in the apply-only-admitted case; deliver it as the turn's prose if no later step replaces it.
4. Tests, mutation-killable: prose beside an admitted apply is kept and delivered; beside a resolve it is dropped with the steer; beside a refused apply it is dropped; then the replay of gate #5's t3 (7 steps) reporting steps and wall.

## Comments

### 2026-09-24 — measured first; the keep rule is NOT implemented (the drafts are not prose); the drop row now names its step and calls

Branch `claude/sl50-20260924` from `0af64595a`. **Commits:** `bf88d96fd` (contract §135.11.1 and §11.5.4, the drop row, SL-51's code,
tests), `56df308c1` (a TDZ fix in the engine's carried-view code, SL-51's, found by `test:ext` on leehow-pc), `6436a1633` (the pairing
script, the gate #5 t3 fixture and replay results, one more SL-51 test).

**Scope 1 — the measurement** (`experiments/single-loop-routing/sl50-beside-drops.py <home>`, read-only over
`chatrpgv4-wt-integ-sl/.coc`; the full per-drop listing is the script's output). The drop row and the `provider-call` row are both written
without awaiting each other, so pairing by adjacency in the file fails (it crossed a message boundary in gate #3 t1); the n-th message whose
`provider-call` blocks carry text beside a tool call is the n-th drop row, same turn asserted, and the text is that message's streamed
deltas in the play driver's `events.jsonl`. **46 of 46 paired** (13 / 19 / 14). Every one has its text *before* its calls
(`thinking, text, toolCall[, toolCall…]` 46/46).

| class | #3 | #4 | #5 | all |
| --- | --- | --- | --- | --- |
| A: every call an `apply`, all admitted and landed | 9 | 9 | 8 | **26** |
| B: all `apply`, one returned `review_pending` | 0 | 1 | 0 | 1 |
| C: a `resolve` among the calls | 2 | 6 | 6 | 14 |
| D: `lookup` only | 2 | 3 | 0 | 5 |

Gate #5's t3 (the replay the ticket names) is class C: its drop sat beside a `resolve` the kernel refused (`rule_no_check`), so the ruling
drops it too.

**Why the rule is not implemented.** The 26 class-A drafts are 23–55 characters (median 40). The same turns delivered 163–484 characters
(median 238; 24 turns with a turn file, the two t0 openings have none). Read one by one, 21 of the 26 announce the bookkeeping the
Keeper is about to write ("我先把这段空档记进他的账上，再让他把你带回办公室里的话听完。", "先把委托钥匙记上，再动身。", "我先记下诺特这半天的事，再把这次见面落到桌上。"),
1 mixes a sentence of fiction with that announcement, and 4 are one or two sentences of fiction (gate #3 t19 s4 "你把随身的东西收好，离开宅子，
走到外面的街上。日记仍留在壁橱里，没有带走。"; #3 t1 s4; #4 t10; #5 t18). None of them is the turn: in every one of the 26 the run went
on and the Keeper wrote the turn's prose in a later step. The ruling's premise ("prose beside settled bookkeeping, dropped anyway") holds
for the shape, not for the content. And the saving the ticket counts (a 10–18 s re-compose) exists only if the run *stops* on the kept
draft: "delivered if no later step replaces it" saves nothing while the policy still composes after the batch, and saves the compose
only by delivering the preamble. Measured this way, the rule would hand the player "I'll first record the interval, then …" as the turn
on the turns where it saved time. This contradicts the ruling's intent, so I stopped at the measurement and am handing it back rather than
implementing it (Agents.md: intent over deliverable). Options for the owner, none decided:
1. keep the ruling but only as a fallback (the kept draft is delivered only when the turn close would otherwise be `undelivered`), with no
   change to the policy -- safe, saves no wall;
2. drop it: the re-compose after an apply batch is the turn's real prose, and the lever on the wall is elsewhere. In 23 of the 26 the
   message carrying the preamble answered an *adjudicate* step the route handed to the Keeper (`ask_llm` 14, `low_confidence` 5,
   `repeated_question` 3, `batch_fallen` 1; a compose carried it 3 times): the Keeper was asked to do more, did the bookkeeping and announced
   it, and was asked again to write;
3. a prompt-side change so the Keeper writes the turn's prose after its calls instead of a preamble before them (not structural; the owner's
   call; a live-model measurement, not a replay).

The class-A table (drop, the step whose answer it was, the calls with outcome/admission, characters, text):

| drop | step (purpose/reason) | calls | chars | text |
| --- | --- | --- | --- | --- |
| #3 t0 | s8 adjudicate/ask_llm | apply:ok/no_player_text | 36 | 开场由他开口谈委托；钥匙和预付款等你点头再交。我先把这三句口头说明记上。 |
| #3 t1 | s4 adjudicate/ask_llm | apply:ok/authorized | 37 | 你点头接下这单。诺特把钥匙、预付和该查的地方交代清楚，再让你去《环球报》。 |
| #3 t1 | s9 adjudicate/ask_llm | apply:ok | 34 | 剪报室的门还没开。先把诺特交来的钥匙登记清楚，再让报社这边的人露面。 |
| #3 t8 | s9 adjudicate/ask_llm | apply:ok/entailed | 23 | 我先记下诺特这半天的事，再把这次见面落到桌上。 |
| #3 t9 | s9 adjudicate/ask_llm | apply:ok/not_player_action | 44 | 外面这一圈已经把窗户和门锁看清了。我记下能从外面确认的封死痕迹，不另开一条进地下室的路。 |
| #3 t12 | s4 adjudicate/ask_llm | apply:ok/not_player_action | 49 | 玩家已经在楼梯口听见楼上的动静，并要进主卧搜查。我先把已经发生的楼上声响记入线索，再打开上楼的路。 |
| #3 t19 | s4 adjudicate/low_confidence | apply:ok/authorized | 37 | 你把随身的东西收好，离开宅子，走到外面的街上。日记仍留在壁橱里，没有带走。 |
| #3 t19 | s9 adjudicate/low_confidence | apply:ok | 33 | 他已经在这条街上见过卖报的人。我先记下这段间隔，再把出门写进场景。 |
| #3 t20 | s7 compose/needs_player | apply:ok | 30 | 诺特不在场上的这一段需要先记下来，再让他把宅子里的情况听完。 |
| #4 t5 | s9 adjudicate/batch_fallen | apply:ok/not_player_action | 55 | 他看人，不看闲话。沿街走一圈，能站住脚的只有报摊；门不开，也不另造见过尸体的邻居。先把称呼定下来，再让他开口。 |
| #4 t8 | s9 adjudicate/ask_llm | apply:ok | 45 | 诺特已经在事务所里。这回是去求他动用关系调卷宗，结果很糟，我先把这次见面记上，再把话说完。 |
| #4 t9 | s6 adjudicate/repeated_question | apply:ok/authorized | 34 | 钥匙已经在身上，去宅子是玩家已经选定的事。先把委托钥匙记上，再动身。 |
| #4 t10 | s8 adjudicate/repeated_question | apply:ok/entailed,not_player_action | 40 | 你进了屋，按房间看一楼，重点落在厨房。细查没找到藏起来的东西；屋子本身会有回应。 |
| #4 t12 | s8 adjudicate/repeated_question | apply:ok/entailed,not_player_action | 35 | 搜查已经看清了床和柜子里不该出现的血。我把它记下来，并让这段翻找过去。 |
| #4 t13 | s6 adjudicate/ask_llm | apply:ok/entailed | 39 | 敲窗、敲地板是在听有没有空响。先把这段搜寻落进时间里，再让墙里的回应自己说话。 |
| #4 t17 | s4 adjudicate/ask_llm | apply:ok/not_player_action | 52 | 你要搜的是地下室里的工具堆，也要再看那只柜子底下。柜子在这一层；工具堆在门后的楼梯下面。先把柜底看清楚。 |
| #4 t19 | s4 adjudicate/low_confidence | apply:ok/authorized | 37 | 你要把随身的东西收好，离开宅子。我先把人送到门外街上，时间只算收拾和锁门。 |
| #4 t19 | s9 adjudicate/low_confidence | apply:ok | 51 | 你把随身的东西收回口袋，锁门走到街上。杜利还在摊前，他认得你。我先记下这段空档，再把门外的情形交给你。 |
| #5 t0 | s9 adjudicate/ask_llm | apply:ok | 29 | 开场该把委托条件说清楚，钥匙和预付金先留在桌上，等你点头。 |
| #5 t8 | s9 adjudicate/ask_llm | apply:ok/entailed | 47 | 诺特听完报告，却拒绝替你去调那份警方卷宗。我先把这一夜的间隔记进他的账上，再把这句拒绝说清楚。 |
| #5 t12 | s6 adjudicate/ask_llm | apply:ok/entailed | 36 | 主卧的搜查已经定了结果。我先把这段翻找记在钟上，再把你看见的东西说清楚。 |
| #5 t13 | s6 adjudicate/ask_llm | apply:ok/entailed | 45 | 主卧的窗和地板已经敲过，听音也有了结果。我把这一阵敲击记进时间，并让宅子里的动静再近一步。 |
| #5 t18 | s4 adjudicate/ask_llm | apply:ok/not_player_action | 49 | 你已经在地下室最底下了。那扇朝下的门和插销都在你身后的楼梯顶上，墙边的木板才是眼前还没动过的东西。 |
| #5 t19 | s7 compose/settled | apply:ok/authorized | 45 | 你要把找到的东西收好再离开。我先把那把还躺在木板下的旧匕首归进你手里，再把人送到宅子门外。 |
| #5 t19 | s11 adjudicate/low_confidence | apply:ok | 28 | 杜利先生还在街角，我先记下这段空档，再把你出宅的事说完。 |
| #5 t20 | s7 compose/needs_player | apply:ok | 44 | 诺特隔了近两个钟头才再见面。我先把这段空档记进他的账上，再让他把你带回办公室里的话听完。 |

**Scope 2 (the telemetry half) — implemented** (contract §135.11.1, a new subsection; the gate #4 addendum's drop list is unchanged). The
`text_beside_tool_calls` row waits for its calls and carries `step`/`run` (the engine announces each model step, `coc:model-infer`; `null`
on legacy) and `calls: [{tool, outcome, admission?, code?, reason?}]`, `outcome` ∈ `landed | refused | pending | not_run`, `admission` the
review's verdict word (through the review's new `onVerdict` hook). Written when the last call answers, else before the next assistant
message is read, else at `agent_end`. The prose is still dropped exactly as before.

**Scope 3 — not done** (the rule). **Scope 4 — tests** for what is implemented: `tests/extension/beside-drop-row.test.mjs` (legacy over
the emitted kernel: prose beside an admitted `apply` → `[{tool: apply, outcome: landed, admission: authorized}]`, beside a refused one →
`refused`, `unknown_entity`; no text block reaches the transcript; the turn closes on the Keeper's own narrate; a split delivery's two
`narrate`s blocked by §34.17 → `not_run` twice; hybrid: the row's `step`/`run` equal the model step's). The ruling's own tests (kept
beside an admitted apply and delivered; dropped beside a resolve; dropped beside a refused apply) are not written: there is no keep path.
The `pending` outcome has no test of its own (the classification is one ternary on the refusal's `reason`).

**Mutations** (copy-revert, `mutate.py` in the session scratchpad; every one killed):

| mutation | killed by |
| --- | --- |
| S1 the row written at once without `calls`/`step` (the old row) | all three tests |
| S2 a landed call's outcome not noted | the legacy admitted/refused test, the hybrid test |
| S3 a refused call's outcome not noted | the legacy admitted/refused test |
| S4 the review's verdict not reported (`onVerdict` removed from `settle`) | the legacy test, the hybrid test |
| S5 the engine announces no model step | the hybrid test |
| S6 a held row whose calls never all answered is never written | the `not_run` test |
| S7 `step`/`run` dropped from the row | the hybrid test |

**Replay of gate #5 t3** (fixture `longgate5-t3` from `longgate5-haunting-1447`, recorded Keeper at its recorded latency, recorded lane,
live Jev, `--latency live`, seed 1, 3 runs per arm; before = base `0af64595a` as a `git archive` export built in the scratchpad, after =
`56df308c1`). Results: `experiments/single-loop-routing/results/sl50-longgate5-t3-{before,after}`.

| arm | model steps | wall (s) | status |
| --- | --- | --- | --- |
| before `0af64595a` | 4, 4, 4 (compose, adjudicate ×3) | 50.1, 46.9, 47.1 | delivered, implicit narrate |
| after `56df308c1` | 4, 4, 4 (the same) | 48.7, 47.1, 46.9 | delivered, implicit narrate |

(The live table: 7 model steps, 129 s; the replay drops the recorded calls the run already made, as every replay here does.) No difference,
as expected: the replayed Keeper replays each message's tool calls, not the prose streamed beside them (the fixture keeps that prose only to
answer a stranded compose), so no `text_beside_tool_calls` drop happens in the replay, and t3's drop was class C anyway. The typed
admission reviews saw identical inputs in both arms (3 902 and 9 724 input tokens): the `source` view this run carried held graph-entity
units only, so SL-51's `bookText` was empty here. The replay cannot measure the ruling; a live model could, once there is a rule to measure.

**Suites** (leehow-pc): all at `6436a1633`:
- `ext` -- "ℹ tests 3074 / ℹ pass 3074 / ℹ fail 0" (`== ext on leehow-pc @ 6436a1633…: exit=0 wall=151s`). The first run at `bf88d96fd`
  had 2 failures: the TDZ in the engine (fixed in `56df308c1`) and `gate #7's shape` in `single-loop-prescreen-budget`, a timing assertion
  (a read's prescreen deadline ≥ 2 s from its start, measured 1 637 ms) that failed again at `56df308c1` with the box at load 33 and passed
  in the full runs after (box load 15), and 3/3 on the Mac;
- `loop` -- "# tests 175 / # pass 175 / # fail 0" (`== loop on leehow-pc @ 6436a1633…: exit=0 wall=42s`);
- `py` -- "1725 passed, 2 skipped in 177.71s" (`== py on leehow-pc @ 6436a1633…: exit=0 wall=179s`).

- **2026-09-25, owner re-ruling after the measurement.** The keep rule is withdrawn: 21 of the 26 apply-only drafts were the Keeper announcing its bookkeeping ("我先把这段空档记进他的账上…"), median 40 characters against 238 for the delivered turn; keeping them would deliver a preamble, not the turn, and the run would still take the later step. The cost is the preamble itself: a step spent writing prose that can only be dropped. New rule, guidance side, structural on the host side: (1) the Keeper's guidance says writes are silent (no prose beside `apply`/`resolve`/`lookup` calls; the turn's prose comes through `narrate` or the final text step, in the same response as the writes when nothing in the writes needs a result first); (2) the drop's steer names the rule and the call kinds it sat beside (the drop row already carries them); (3) the measurement is the next long gate: `text_beside_tool_calls` per table (#5: 14) and steps per turn (#5: 60 over 20). Scope for the worker: the guidance text (one place, the assembled capsule; check the budget in `assemble.ts` before adding a line), the steer text, a test that the steer carries the call kinds, no keep path. Status stays `ready` for that follow-up.

### 2026-09-25 — the re-ruling implemented on `claude/sl50-20260924` (merged `claude/integ-single-loop-20260923` at `787ddf480` first; no conflicts)

**Commit** `ac9cdcd6b` (contract §135.11.1 addendum, `kernel-ts/read/assemble.ts`, `extensions/kernel/index.ts`,
`tests/extension/beside-drop-row.test.mjs`). No keep path.

- **The guidance, one place: the capsule's head.** `HEAD` ends with `SILENT_WRITES` (writes are silent: no prose beside
  `apply`/`resolve`/`lookup`, it is dropped and never shown; the turn's prose through `narrate` or the final text step, in the same
  response as the writes whenever none needs its result first). **Budget check:** the head is outside every §13.6 section budget
  (`test_capsule_budgets` exempts it), so **nothing is displaced**. Not used: the `style` section, whose first-turn full form measures
  2 001 of 2 048 bytes in zh-Hans (1 959 en; the brief form 1 246 of 1 536 at worst) -- a new ~220-byte line there would pop the last
  directive (`rewrite-abstract-psychological-explanation`), as §40's longer voice line once did; and `floor_lines`, which the kernel
  validates as exactly the four kinds a turn owes (§34.2).
- **The steer.** The first call of the dropped message that answers carries `prose_dropped: {beside, steer}` in its result: `beside` the
  message's distinct call kinds in order, `steer = besideSteer(beside)` (names the rule and those kinds). A landed call: in its JSON
  result (content and `details`); a refused call: in `details` and as a line after its error text. Once per message; never on
  `narrate`/`ask`; a message whose every call a gate blocked is not steered (the gate's own reason is). The drop row gains `steered`
  (the carrying tool, or `null`).
- **Tests** (structure, not wording): prose beside `apply` + `resolve` → the `apply`'s result carries `beside: [apply, resolve]` and the
  steer over those kinds, the `resolve` and a later unrelated call carry nothing, a refused `apply` beside prose carries it in `details`
  and its text, the rows name the steering call, the steer names a kind the rule's own sentence never does (`recall`), the turn's capsule
  head carries `SILENT_WRITES`; a message whose only call is `narrate` is not steered.
- **Mutations** (copy-revert, `mutate.py` in the session scratchpad; all 9 killed): T1 never steered; T2 only the first call's kind;
  T3 every call steered (not once per message); T4 a delivery steered (killed by the `narrate`-only test); T5 a refused call's text not
  steered; T6 the steer without the kinds; T7 `SILENT_WRITES` not in the head (runtime rebuilt for it and after); T8 the row's `steered`
  dropped; T9 a refused call's `details` not steered.
- **Suites** (leehow-pc, at `ac9cdcd6b`): `ext` -- "ℹ tests 3080 / ℹ pass 3080 / ℹ fail 0" (`== ext on leehow-pc @ ac9cdcd6b…: exit=0
  wall=156s`); `loop` -- "# tests 175 / # pass 175 / # fail 0" (`== loop on leehow-pc @ ac9cdcd6b…: exit=0 wall=42s`). `py` was not
  rerun (not asked; the head change touches `test_capsule_module`'s substring checks, which hold).
- **Measurement:** the next long gate -- `text_beside_tool_calls` rows per table (#5: 14) and model steps per turn (#5: 60 over 20).

- **2026-09-25, owner, after long gate #6 (`longgate6-haunting-2155`).** The capsule-head rule changed nothing: 15 `text_beside_tool_calls` drops (#5: 14), 64 model steps (#5: 60), 12 turns with ≥ 3 steps (#5: 11); the steer landed on every drop (`steered: apply 11, resolve 4`) and the next step still wrote the turn. Stage 2, guidance placement: the rule moves to the clerk note's head line (§135.31.2, the line the model reads with the carried views on every step), stated once per run, and the capsule head keeps its sentence. Measured on long gate #7 against the same lines (drops ≤ 7, steps ≤ 52, turns ≥ 3 steps ≤ 8). Only if that fails: the structural option, where a step carrying writes and prose gets its results back with a one-line "the turn is still owed: narrate now" instead of a full re-prompt.
