# Turn Floor: the affirmative shape of a Keeper turn

_Date: 2026-09-11. Status: implemented on branch `claude/turn-floor-20260911` (contract §34); `pytest tests/kernel` 1149 passed; `npm run test:ext` passes but for the pre-existing `system-language` failure on `extensions/image-gen`; two live tables played on the branch (below). Packaged from 48bd330a and installed; still owed: the novice-human gate. Baseline model for every claim and every acceptance: `xai/grok-4.6`, thinking `low` (user ruling 2026-09-11: do not switch to grok-4.3). User ruling 2026-09-11 on the shape of the rules: the prohibitions are cases of two principles, immersion and freedom, and the turn stops only when the spotlight is back on the player._

## Problem Statement

Per-turn Keeper output is thin. Two live tables on this tree, both The Haunting in zh-Hans:

| table | Keeper model | player | Keeper turns | median chars | zero-receipt turns | implicit closes | director beat adopted |
|---|---|---|---|---|---|---|---|
| 2026-09-09 `game-4ca26bef` | grok-4.6 low | AI, 40–80 char declarations | 37 | 167 | few | 0 / 37 | 9 / 37 |
| 2026-09-11 `game-e3fdb775` | grok-4.6 low (t0), then grok-4.3 low (t1–t11) | human, 2–10 char lines | 12 | 37 | 10 / 12 | 11 / 12 | 1 / 12 |

The second table is the product's target case: a human typing one short line. On it the player wrote 然后呢 three times and 那我下一步应该做什么 once; the Keeper answered 诺特靠回椅背，等着你下一步 and 你想先去哪里查，都行. On turn 4 the player attacked Knott; `resolve` refused with `needs` (Knott has no stat block), the fix text offered "or narrate the exchange without dice", and the Keeper narrated a pickaxe blow that never rolled and never landed a receipt, then repeated the aftermath for four turns. Every one of turns 1–11 was closed by the host's implicit narrate: the Keeper wrote prose and called no tool.

The 09-09 table is the good case on this tree and it still runs at a third of what the two predecessor products delivered. `chatlab`'s TRPG mode set per-scene Chinese budgets of 450–750 (exploration), 300–600 (dialogue), 240–450 (combat), 600–900 (horror); `chatrpg` v1 set no numbers at all and still ran full turns.

A code survey (kernel read side, kernel extension, prompts, packages, content graphs) puts the cause in the system, not in one table:

1. **Every active layer was a prohibition; no layer said what a turn contains.** `prompts/keeper.md` forbade numbers, elapsed time, option lists, story menus, a trailing question, the investigator's thoughts, restating and ignoring the capsule; its one affirmative sentence was "stop only at a real obstacle, a real decision, or an opportunity an uninformed player can understand". The six `style.axes` are all "avoid…"; all eleven `craft-directive` lines are rewrites or guards. `narration-craft` 1.1.0 (#75) removed the only floor language the tree had on the grounds that its 600–1500 character ceilings never bound anything. The observation was right and the conclusion inverted: the ceilings never bound because the problem was the floor, and the retirement took the floor with them. Contract §30.12 recorded "what no layer says any more" and nothing replaced it. The prohibitions themselves had accreted case by case; the user's reading is that they are all instances of two principles and should be stated as such.
2. **Nothing in the system read the player's words.** `turn.player_text` passed through the capsule verbatim; the Director's `intent` is the previous turn's `resolve` intent, `stalled_turns` counts turns without a clue/move/session receipt. `content/director/director-graph.json` authors 34 `player-signal` nodes and the thresholds `override-low-agency-count`, `pressure-yielded-low-agency-count`, `recent-intent-window`, `live-affordance-minimum`; none is read by any code.
3. **The Director's advice had no payload.** `directorSection()` emitted a beat name, a `because` list and scores; only `REVEAL` carried entities. On the 然后呢 turn it said `PAYOFF` with `undiscovered_here = 0`, `exit_condition_met = True`, `agenda_npc_present = 1`: the scene was done, Knott wanted the job started, seven exits stood unlocked, and the section handed the Keeper nothing it could put in a sentence. Adoption was 9/37 and 1/12.
4. **An implicit close was a free pass.** When the Keeper ended on prose with no tool call, `extensions/kernel/index.ts` called `table.narrate` for it and recorded `implicit: true`. No steer, no marker in the next capsule. The 09-11 Keeper learned in one turn that nothing was required of it.
5. **An error's fix text is executed literally.** The combat `needs` fix said "use lookup catalog for a creature stat block, or narrate the exchange without dice". The second clause is the path the Keeper took, and it is a law-2 violation.
6. **Every check was a "too much" check.** The verifier's four kinds are `reveal`, `uncommitted_state`, `player_agency`, `play_language_mismatch`; `narration-audit` checks receipt realisation and excludes length, style and voice; admission gates settlement and never sees prose. A zero-receipt 25-character turn passes all three.
7. **Lanes follow the Keeper's model.** `resolveLaneModel` falls back to `ctx.model` when `PI_COC_VERIFIER_MODEL` / `PI_COC_MEMORY_MODEL` are unset. The 09-11 switch to grok-4.3 also switched the verifier to grok-4.3 with `reasoning_effort: none`; it returned zero findings in under a second on the turn that narrated an unrolled attack.
8. **The dead design was already in the tree.** `content/craft/text-graph.json` carries `narration-budget-mode`, `render-slot`, `player-input-handling`, nine `beat-type` and nine `review-rule` nodes; `kernel-ts` reads none of them.

The mirror effect compounds all of this: a model at low effort answers a two-character line with a two-clause line unless something in front of it says otherwise. The predecessor products said otherwise on every turn, with content-kind obligations, not word counts.

## Solution

Give the table a **turn floor**: the kinds of content a Keeper turn owes, stated affirmatively in the layers that already reach the Keeper every turn, fed by machine-derived material the capsule already holds, and no longer waived by an implicit close. No character quota becomes a gate; no new model call is added to the foreground; the seven verbs, the capsule, the Director, the Mod interface and the verifier keep their shapes.

Behind the floor, the base prompt's fourth law is restated as two principles, and every specific prohibition becomes one of their cases:

- **Immersion.** Nothing out-of-game enters the story text. Roll values, targets, grades, ledgers, elapsed figures, rule option lists, tool names, enum values and field names are system facts and travel only as the mechanics projection.
- **Freedom.** Nothing in the story text narrows what the player may do. No story menus, no fixed option lists, no "do you want to continue?" where nothing else is possible, no asking how to handle a failed check.

The floor has four kinds. Every `narrate` carries each of them unless the fiction refuses one on purpose:

- **Uptake.** The player's declared action, question, attitude or pause is enacted from the world's view before or with its result. A speakable line is rendered as the investigator's line with its meaning kept. One word from the player is still a declaration, and the player's length says nothing about the Keeper's.
- **The world's answer.** What the rules settled this turn is perceptible. When nothing was settled, the world still moves: a person present acts from their `wants`, `fears` and `voice`, or the scene changes by what the player did. A turn in which nothing changes and nobody acts is not a quiet scene; it is an empty one, and `director.offer` says what can move.
- **A voice.** When someone is present and the exchange touches them, they speak at least one line in their own voice. Silence is a choice the prose shows, not a default.
- **The handoff.** The turn stops only when the spotlight is back on the player: they hold enough to judge — what the investigator perceives of the scene, the clues in hand, who is present and how they stand — and have more than one real thing to do. Then the move is theirs, through a person's push or question, a visible pressure, a route or object in reach, or a consequence they must answer. A midpoint where they have nothing to decide is not a stop: the declared action is carried through its uncontroversial part until an outcome, an obstacle, a gated risk or a real fork. Halfway up the stairs is not a decision, and "do you go on?" there is not a question. Never a menu. A question that belongs to someone in the scene or to the world is theirs to ask; what stays out is the reflexive "what do you do?" tacked onto a turn that already hands the move back.

Five system changes carry it:

1. **Base prompt, `style.floor` and packages state the floor** (`prompts/keeper.md`; `content/craft/beat-directives.json` `floor_lines` emitted as `capsule.style.floor` on every turn; `narration-craft` 1.2.0; `keeper-pacing` 1.1.2).
2. **The Director carries an offer, not only a beat.** `capsule.director.offer`: at most three machine-filled rows from material already in the capsule, each a person, a route, a pressure or a consequence the Keeper can put in a sentence this turn.
3. **Structural signals, no semantic classifier.** `empty_turns`, `previous_close` and `repeat_input` join the Director's signals; `RECOVER` scores on them and its offer instantiates the keeper-pacing ladder. No word list, no regex, no length rule reads the player's meaning.
4. **An implicit close on an empty turn is steered once**, and the steer is strictly additive: if the second leg brings nothing, the dropped draft closes the turn as before.
5. **Error fix texts stop pointing at the thin path.**

Character ranges return only as an opt-in `narration-craft` setting `density_guide`, default `off`, worded as the play language's expected density per beat and never checked by code.

## User Stories

1. As a novice player typing one short line, I want the world to answer with something that happened and someone who acted, so that "then what" never gets "he waits for you".
2. As a player, I want my declared words enacted on the page, so that I can see the Keeper took them up before the result.
3. As a player in a room with an NPC, I want that person to speak from their own motives, so that the scene has a second party in it.
4. As a player, I want every turn to stop only where I have enough to judge and more than one real thing to do, so that I am never asked to decide at a midpoint where nothing is mine to decide.
5. As a player who attacks, hides, lies or does anything uncertain, I want the dice to settle it before the prose describes it, so that a blow that was never rolled never lands.
6. As a player lingering in a quiet scene, I want the quiet to be played, not an empty turn, so that quiet and empty stop being the same thing.
7. As a Keeper operator, I want the prohibitions stated as cases of two principles, so that the next rule is added under immersion or freedom or not at all.
8. As a Keeper operator, I want the floor stated in the layers already re-sent every turn, so that no new prompt layer or model call appears.
9. As a Keeper operator, I want the Director to hand the Keeper material it can use in a sentence, so that a beat name is no longer the whole advice.
10. As a Keeper operator, I want the host to notice a turn in which the Keeper used no tool and landed nothing, so that the tool loop is not abandoned silently.
11. As a reviewer, I want thinness diagnosed with structural facts (receipts, tool calls, close kind, offer taken), so that no word count becomes a quality score.
12. As a campaign owner, I want old package versions and locks preserved, so that existing campaigns change only at a safe boundary.
13. As a developer, I want no regex, keyword list or hardcoded semantic table deciding what the player meant, so that the standing rule against hardcoded semantics holds.
14. As a developer, I want the Keeper to read a refusal's fix text as the lawful next step, so that error text never suggests a world change without a receipt.

## Implementation Decisions

### D1. The floor lives in the base prompt, `style.floor` and `narration-craft`, as content kinds

- `prompts/keeper.md`: law 4 is rewritten as the two principles with the existing specifics as their cases; "no question tacked on at the end" becomes the freedom-side rule above. The paragraph "The turn the player gets" is rewritten around the four kinds and the spotlight stop rule, and adds the mirror warning. The prompt stays English (§16.1); the sample low-information input is described, not quoted in CJK.
- `content/craft/beat-directives.json` gains `floor_lines`, four non-empty strings validated at load (`TextGraph`), emitted as `style.floor` on every turn regardless of `full`. The text graph and its digest are untouched: the floor is not a `craft-directive` node, so the four-per-beat cap and the manifest recipe stay as they are. The brief-turn `style` budget rises from 1024 to 1536 bytes to carry it (`SLICE3_BUDGETS`, the §13.6 table, `test_capsule_nine`, `test_capsule_budgets`).
- `narration-craft` 1.2.0 (new bytes, new version, §26 freeze): `agent.md` opens with the floor as craft including the spotlight stop rule, restores the routine-turn warning as craft, keeps the crisis frame, the NPC line and the opening perception as an offer, and adds the mirror warning; `settings` gains `density_guide: "off" | "on"` default `off`, with the per-beat ranges (routine 300–600, costly 400–750, reveal/cut 500–900, payoff/climax 700–1500 play-language characters) as an expectation the kernel never counts. No `*_chars` ceilings and no paragraph caps return.
- `keeper-pacing` 1.1.2: names the two structural RECOVER signs and points the recovery ladder at `director.offer`; settings unchanged.
- The §30.7 per-turn brief ceiling (4000 bytes for all active briefs) stands; the two briefs were rewritten densely (631 and 615 bytes) so the five default packages total 3997.

### D2. `director.offer`: machine-filled, three rows, no model call

- `kernel-ts/read/offer.ts` `directorOffer(beat, sources)` returns at most three rows `{kind, who?, where?, line, from}`, `kind ∈ {person, route, pressure, consequence}`, `line` clipped at 120 characters on a word boundary with an ellipsis, `from` the capsule path each row came from:
  - `person`: each present NPC with `wants`, in `presentSection` order; line = name, `wants`, then the first `would_lie_about` or else `voice`; `can_hand` lists up to two of their `knows` clues still undiscovered — on table B the Keeper told the research leads through Knott three times without landing `knott-research-leads`, and the verifier reported each as a reveal.
  - `route`: each exit with `unlock_when.met !== false` and `material` ready, ranked: named by `mods.thread.next` first, then guided by a present NPC whose `knows[].clue` is the exit's `clue_discovered:` unlock, then the rest; line = the thread's `line`, or "<name> can point the way to <scene>", or "the way to <scene> is open".
  - `pressure`: `mods.pacing.threat_clocks[]` with a `next`, then `pressures[]` rows.
  - `consequence`: last played turn's receipts — a failed non-dice roll ("<actor>'s <skill> failed last turn; its consequence is still owed"), an `npc` receipt with a `stance` ("<name> turned <stance> last turn (<why>); that stands in the room now").
- Order by beat (`OFFER_ORDER`): RECOVER consequence, person, route (the keeper-pacing ladder); PAYOFF and CUT route, person, pressure; CHARACTER person, pressure, route; PRESSURE pressure, consequence, person; SUBSYSTEM consequence, pressure, person; the rest person, route, pressure. One row per kind first, then the remaining seats from what is available. A consequence still owed always keeps a seat: when the beat's order left it out, it takes the last one.
- Wired in `buildCapsule` after `mods` exists (the thread and pacing sections are inputs). The director budget rises from 1536 to 2048 bytes; offer rows are popped first when the section is over, before `fitBudget` touches `because` or `grounded_by`. `HEAD` names `director.offer` and `style.floor`.
- `directorAdoption()` gains `offer_taken: string[]` (present whenever the turn's capsule carried an offer): `route:<scene>` by a `move` to it, `person:<name>` by a `clue` credited to them, an `npc` receipt on them or a `roll` against them, `pressure:<threat>` by a `threat` tick. Telemetry only.

### D3. Structural signals into the Director; the semantic reading stays with a model

- `signals()` adds `empty_turns` (consecutive `playedRecords` with `receipts.length === 0`), `previous_close` (`played[0].closed_how`, `explicit` when absent, `none` with no played turn) and `repeat_input` (current `player_text` equals the previous, trimmed, character for character). `SIGNALS` and the `because` lines follow.
- The Director graph adds `scoring-rule:recover:empty-turn` (0.53), `scoring-rule:recover:repeated-input` (0.85) and `threshold:recover-empty-turns` (1), with their `scores` relations; the manifest digest and `node_counts` are recomputed with the canonical recipe (Python `json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)` reproduces `jsonDigest`). The empty-turn value is the largest two-decimal value whose weighted score stays under the stalled PRESSURE band (0.8) in every authored structure (hub_sandbox binds it at 0.53): one quiet turn puts RECOVER on the board and its ladder in the offer without overturning the pacing doctrine; a second empty turn meets the stalled rules at 0.85, and a repeated input outranks PAYOFF and CHARACTER on its own.
- No code reads the meaning or the length of `player_text`: 我接 and 然后呢 are the same length and opposite in agency. The authored `player-signal:low-agency:*` vocabulary stays unread until a model populates it; the two lawful populators are the Keeper's `resolve` `action.intent` and, if ever wanted, an admission-style lane. Neither a keyword list nor a regex is authorised.

### D4. Implicit close on an empty turn: one steer, then accept

- The kernel extension counts COC tool calls per turn (`toolCallsThisTurn`, refused calls included). In `message_end`, when the Keeper ends on prose, no tool was called this turn, the turn is not the opening and no steer was spent, the host keeps the draft in `floorDraft`, drops the text blocks, sets a `deliveryFix` of kind `floor`, and records `{lane: "floor", turn, steered: true, round_trips}`; `agent_end` sends it as one `coc-host` steer naming `director.offer` and the four kinds. The second leg is honoured however it comes — an explicit `narrate`, prose closed implicitly, or nothing, in which case the dropped draft closes the turn as before. A turn in which any tool was tried is not steered.
- The implicit `table.narrate` carries `implicit: true`; the kernel writes `closed_how` on the record (`ask` is always `explicit`) and `capsule.recent` rows carry `closed` and `receipts` when the record has them.
- Cost: one extra agent leg only on turns that were about to close empty and toolless. On the 09-09 table it would have fired zero times; on the 09-11 table eleven.

### D5. Fix texts name the lawful route

- `kernel-ts/combat/execution.ts` and `combat/index.ts`: the no-stat-block `needs` fix now reads "pin a stat block first (lookup catalog, then apply npc with the values and why) and resolve again; or resolve it as an uncontested attempt against someone who cannot fight back. Nothing without a receipt has happened: do not narrate a blow as landed". The wider defect that named NPCs without stat blocks cannot be fought stays on its own ticket.

### D6. Lanes and model

- Baseline: `xai/grok-4.6`, thinking `low`, for the Keeper and, by fallback, the lanes. The product sets no model; a `model_change` away from grok-4.6 inside a live table is reported as evidence contamination, not as a run.
- `PI_COC_VERIFIER_MODEL` and `PI_COC_MEMORY_MODEL` stay environment choices (§32 ruling: provider names are the user's). Verifier latency on grok-4.6 is out of scope and stays a separate item.

### D7. What does not change

- The seven verbs, their schemas and `narrate`'s single `text` field. `ask` stays mechanics-only.
- `narration-audit` stays receipt-grounded and blind to length and style. The verifier's four kinds stay; no fifth "too little" kind is added.
- The text graph, its digest and the four-per-beat directive cap. The frozen Python oracle: `ts-kernel-read.test.mjs` projects the three new signals and their `because` lines out of the comparison (the `withoutGates` precedent) and checks the live digest against the manifest, the rest of the refusal against the oracle.
- Frontend. The mechanics panel already shows receipts; an empty turn shows prose only.
- Mod package freeze and campaign locks: 1.2.0 / 1.1.2 are new bytes; old campaigns upgrade at a safe boundary through the existing settings flow (#70 semantics). Campaigns are compile snapshots: acceptance needs a fresh campaign.

## Testing Decisions

- Highest seam: a live table on the product path, main-session Keeper on grok-4.6 low, one natural player line per turn, from opening to a real ending or a real blocker. Two player conditions on the same module: (a) declarative 40–80 character lines as on 09-09; (b) a human or a persona giving 2–10 character lines including at least three low-information inputs (然后呢, 继续, a bare repeat), one attack on a named NPC, one deliberate quiet turn, one out-of-character question. No script chooses the Keeper's actions; no `kp_settle_turn`, batch settle or fixture prose counts as play.
- Structural diagnostics, recorded and compared with both baselines above, never used as pass/fail alone: zero-receipt turns, implicit closes, `floor` steers fired, round trips, `offer_taken`, verifier findings by kind, delivery latency (the D4 steer must not raise the median turn time by more than one agent leg on the turns it fires).
- Editorial read of every turn against the four kinds and the spotlight rule: uptake, world's answer, voice where someone is present, handoff at a real fork with enough to judge. Recorded per turn as yes / no / refused on purpose; not summed into a score.
- Character counts are reported descriptively beside the baselines (medians 167 and 37). They are not acceptance criteria.
- Contract tests through the real path, all present on the branch and each failing when its change is reverted: `tests/kernel/test_turn_floor.py` (the four floor lines on full and brief turns; `empty_turns`, `repeat_input`, `previous_close` and the two RECOVER hits read from the graph; one quiet turn not overturning PRESSURE; the offer's person, consequence and route rows and their sources; `offer_taken` for a walked route; the director budget; `closed_how` and `recent`; the graph's two rules, threshold and recomputed counts; the combat fix text), the amended `test_capsule.py`, `test_capsule_nine.py`, `test_capsule_budgets.py`, `test_transactions.py`, `test_director_scoring.py`, `test_mod_director_text.py`; `tests/extension/turn.test.mjs` (one floor steer on a toolless prose turn and none after a tool call; the second leg honoured; the draft fallback; `implicit: true`); `tests/extension/ts-kernel-read.test.mjs` projections.
- Existing suites: `check:kernel` passes; `npm run test:ext` 785 of 787, the one remaining failure being `system-language` on `extensions/image-gen` strings committed by another session on 0.9.2a before this branch, not this work; `pytest tests/kernel` one file set at a time.
- The novice-human gate of the parent spec stays open and is not claimed by this work.

### Live tables on the branch (2026-09-11, grok-4.6 low as Keeper, main session as the player, one line per turn, fresh campaigns locking narration-craft 1.2.0 and keeper-pacing 1.1.2; evidence `.coc/campaigns/turn-floor-{a,b}/` and `.coc/playtests/turn-floor-{a,b}-1/` on the worker worktree)

| table | player | Keeper turns | median chars | min | zero-receipt turns | implicit closes | floor steers | verifier findings | wall s / turn |
|---|---|---|---|---|---|---|---|---|---|
| baseline 09-09 | AI, 40–80 char | 37 | 167 | 63 | few | 0 | — | agency 6, uncommitted 7, reveal 5 | — |
| baseline 09-11 | human, 2–10 char (grok-4.3 from t1) | 12 | 37 | 24 | 10 / 12 | 11 / 12 | — | 0 (lane on 4.3) | — |
| **B** `turn-floor-b` | 2–10 char: 我接, 然后呢 ×3, 那我下一步应该做什么, 我想把你打一顿, 继续, a quiet line, 诺特是谁, 去报社, one declarative | 11 | 227 | 180 | 5 / 11 | 0 / 11 | 0 | reveal 3, agency 3, uncommitted 5 | 23–214 |
| **A** `turn-floor-a` | 40–80 char declarations | 6 | 265 | 171 | 1 / 6 | 0 / 6 | 0 | uncommitted 3 | 96–222 |

Editorial read against the four kinds, table B: every turn enacted the player's words (然后呢 became Knott pushing, then opening the door, then naming the three ways; 继续 after a raised fist became the bell and the clerks); every turn had the world act and Knott or Wilmot speak in voice; every turn ended at a real fork (leave or ask; lower the fist or step in; give your name or go). No turn stopped at a midpoint. The attack on Knott (no stat block) was not narrated as landed: the Keeper followed the new fix text, pinned Fighting and Dodge with `apply npc`, three `resolve` calls still refused (the open NPC-cannot-be-fought defect), and the prose stopped at the raised fist with Knott's hand on the bell. Table A ran at the 09-09 baseline's rhythm with longer turns and clue, move and roll receipts on five of six turns.

Repaired the same day (contract §34.10): a person the book gave no numbers can now be given a rulebook archetype profile through `apply npc archetype`, rolled inside the archetype's ranges and pinned once; the combat refusal names the three archetypes and the source read. Findings for other tickets, not repaired here: (1) on B the Keeper told the research leads through Knott three times without `apply clue` for `knott-research-leads`; the verifier reported each as a reveal — `director.offer` person rows now carry `can_hand` for exactly this. (2) Semantic repetition on B turns 2–4 (the same three ways in Knott's voice thrice) — the repetition axis, not the floor. (3) Admission on grok-4.6 costs 15–63 s per reviewed call and timed out once (A turn 5, `admission_unavailable` reported to the player as a service notice, correctly); §32's `PI_COC_ADMISSION_MODEL` recommendation stands. (4) The verifier on grok-4.6 timed out 3 times in 26 runs and returned one `model_error`. (5) The verifier's `player_agency` reading collides with uptake when the declared action is rendered ("你朝门口跨了一步，拳头抬起来" for 我想把你打一顿): enacting the declared action is the floor's first kind, and the two remits need one sentence agreeing where elaboration ends.

## Out of Scope

- Character or paragraph quotas as gates, ceilings or scores; `density_guide` is guidance only and default off.
- A second narrator model, a rewrite loop, a synchronous literary grader, a fifth verifier kind about thinness.
- Any keyword list, regex or hardcoded table that decides what the player meant; any length-of-input rule.
- Populating `player-signal:*` or reviving `narration-budget-*`, `render-slot`, `review-rule` data.
- Storylets, NPC pre-simulation as a lane, auto-continuation after dice (the kernel returns the result before the Keeper narrates).
- Synthesising stat blocks for NPCs the book left without one.
- Verifier latency and lane model defaults.
- Frontend changes.

## Further Notes

- Order of work as executed: D5 and D4 (host and kernel, small); D1 (prompt, `floor_lines`, two package versions); D2 and D3 (kernel read side and closer, graph nodes and manifest); tests and the amended contract tests; §34 of `docs/kernel-rpc.md`; two live tables; the candidate App packaged from 48bd330a and installed as /Applications/PipiCOC.app on 2026-09-11 (previous App kept as a tar in the packaging worktree's .build.noindex). Merged with 0.9.2a (creation difficulty took §33, so the floor is §34).
- The predecessor products are the reference, not the recipe: `chatlab/backend/agents/trpg/prompts_v2.py:263-282` (budgets, PC beat), `phase_generate.py:404-417` (menu ban with out-of-band exits), `preprocess_helpers.py:262-291` (low-information turn seed), `npc_presim.py`; `chatrpg/backend/services/trpg_framework_adapter_ic_prompt.py:24-31, 64-69` (immersion contract, mandatory handoff), `trpg_ic_runner.py:1661-1689` (auto-continuation). This spec takes their content-kind obligations and leaves their markup, budgets-as-rules and second pass.
- If the live table shows the floor stated and offered but still unmet on grok-4.6 low, the next lever is thinking level, not a longer prompt; that is a measurement to take, not a decision to make here.
