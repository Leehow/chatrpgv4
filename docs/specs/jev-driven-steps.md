# Jev-driven steps: the clerk's reach covers the Keeper's consequence calls, and the Keeper becomes the writer (Stage 2 → Stage 3 of the single loop)

Status: ready-for-agent (spec written 2026-09-26 after long gates #11/#12; owner's go "既然如此，你应该知道该怎么优化了吧"). Tickets SL-76…SL-79 in `pi-native-single-loop-tickets/`. Contract: §135.32. Load the `typesafe-jev` skill before touching any question in here.

## Problem statement (measured)

Twelve long gates on the same 20-turn script. The compile (§135.30) already routes the player's declared action through Jev: on gates #11/#12 it selected 25 / 26 of the mechanical writes (`apply`+`resolve`) and none of those was refused. The other half, 33 / 30 writes, the Keeper chose on its own, and that half holds every misuse a Keeper without thinking produces:

| table | Keeper / thinking | compile-routed writes | Keeper-chosen writes | `unknown_entity` | refusal-budget cuts | max reads in a turn |
|---|---|---|---|---|---|---|
| #9 | deepseek, on | – | – | 0 | 0 | 5 |
| #11 | deepseek, off | 25 | 33 | 9 | 2 | 12 |
| #12 | deepseek, off | 26 | 30 | 5 | 2 | 7 |

The nine refusals of #11 were social decisions with the roles reversed (an NPC as `actor`), the five of #12 were `apply npc` on an object, on garbage, and on the investigator's own name; #11 t6 spent eleven `recall` calls on one turn. Every one of these is a **free-text handle**: the Keeper wrote a name or an id where the graph already knew the closed set. Thinking on removes them (gate #9) at ≈35 s a call; SL-71/72/73 make each refusal survivable. Neither closes the class.

## What the outside world does with the same problem (from the `typesafe-jev` skill)

- **browser-use jev-ultrafast**: each cycle the code enumerates the page into an indexed action space; one Jev request asks the operation and, speculatively, every operation's target; only the pairing executes; a small LLM writes text only when the operation is TYPE_TEXT; "model output never becomes selectors, coordinates, shell commands". 7.1 s per booking, 91% fewer protocol calls.
- **function_calling cookbook**: function name and each closed argument are separate Choices in one call; a "stated?" Noul per optional argument lets it be omitted; the call's confidence is its weakest judgment.
- **skill_suggestion cookbook**: a wide Choice over the whole roster plus Nouls "does anything apply", then a narrow verification of the top 3.
- **jev-got / rpg-jev / jev-npc-interaction**: the story model writes, Jev reads the fiction back into closed labels; NPC actions are a Choice over authored options with a parallel credibility Noul; code applies effects.

The pattern is one: **code enumerates, Jev judges semantically inside the enumeration, an LLM writes only text.** Discretion is not lost: Jev reads the player's sentence and the scene as a semantic model; what disappears is the free-text handle. The 2026-09-23 clerk/boss ruling drew the line at "declared bookkeeping"; the owner moved it on 2026-09-26 (below).

## Ruling (owner, 2026-09-26; amends the 2026-09-23 Authority ruling in `pi-native-single-loop.md`)

Tool selection is Jev's wherever the host can enumerate the candidates from real state. The 2026-09-23 line "people not on the roster, undeclared checks, consequences and pending choices are the boss's" is narrowed to: **a consequence whose candidate the graph, the roster, the rules data or the session view can issue is the clerk's; only a consequence with no issuable candidate stays the Keeper's.** The Keeper keeps every word to the player (`narrate`, `ask`, `say`) and keeps its free tool calls for now (Stage 2) so the residual can be measured; when the residual stays near zero across tables the Keeper's step becomes narrator-only (Stage 3). Jev never writes prose and never `ask`s; the host never bypasses "delivery requires the writer".

## Design

### D1. New candidate classes (Stage 2), each from a real read, each with closed parameters

| class | issued when | source read | bound parameters | Jev question (one Noul per candidate, §135.30 fan-out) | clerk authority |
|---|---|---|---|---|---|
| `npc_reaction` | an authored NPC is present in the scene and this table has no first-impression receipt for (investigator, NPC) | `table.capsule.present[]`, the natural-npc decisions in `table.resolve.options` (`natural-npc:first-impression`), the world's first-impression `state[pair]` | `actor` = the party's investigator (the compile's actor row when several), `target` = the NPC handle, `decision` | "In this declaration the investigator engages this person now (speaks to, approaches, is received by), not merely notices or names them." Criteria carry the person's label, role and where they stand. | `consequence_bookkeeping` (new, §135.3 addendum) |
| `clue_follow_up` | a clue of the scene whose gate the run's settled receipts satisfy and that is not yet discovered | §32 affordances `clues:[{clue, gate, discovered}]` / capsule `known.clues_here[].gate`, evaluated in code against the run's receipts (the gate is data; Jev is not asked whether a gate holds) | clue handle, `how` composed from the settled action (§135.28) | "The action as settled reaches this clue (the place searched, the person asked, the thing examined is where the book puts it)." | `consequence_bookkeeping` |
| `time_cost` | a settled clerk action whose rules-data shape (§136 `time_cost`/`duration`) states a cost and the run has not yet advanced the clock for it | `ModuleGraph.mechanicsOf`, the receipts of this run | minutes (stated), `why` composed | none when the shape is stated (direct, §135.28's `stated` path); an `_unstated` cost has no rules default today, so `minutes` stays the Keeper's | `consequence_bookkeeping` (SL-76 followed §135.32; corrected 2026-09-26) |
| `session_step` | (exists) | – | – | – | – |

Not candidates (stay the Keeper's, by construction): a person the graph does not know (needs a name: `from_passage`, §11.5.7), a hazard trigger (danger is the Keeper's, scene-obligations ruling 1), a sanity bout (consequence of a resolve, the kernel's), a pending choice (`ask`).

### D2. Question hygiene (binding for every question in this spec)
1. One Noul per candidate, never a pick-one over candidates (prototype: 17 candidates diluted to 0.20/0.15/0.13). The exit stays a Choice over `ask_llm / read_more / finish / none_of_above`.
2. Per family a "does anything of this family apply" Noul (the `exists` question of semantic_find): Choice probabilities sum to 1, a family must be allowed to be empty.
3. State = the player's sentence, the scene line, the present people with `met` flags and labels, the run's receipts so far (labels, not ids), the candidate's own detail. Nothing else: no history beyond the capsule's clerk-did, no kernel-internal tags (`authority`, `basis`), no dormant families.
4. Optional parameter → a "stated?" Noul (function_calling), else the rules default (§135.28); a required closed parameter → a Choice over its options; a required open parameter → the candidate is not issued (it is the Keeper's).
5. Gates: row clears at `yes ≥ 0.5 and ≥ 2×no` (existing `ROW_MIN`/`ROW_RATIO`, §135.30); a candidate's confidence is the weakest of its judgments; thresholds are data in `content/rulesets/coc7/host-budgets.json` beside SL-72's, never literals.
6. Every route records the full distribution per question (`lane: "route"` rows), the candidate set offered, and the exit; a shadow decision records what the Keeper then did.
7. Model pinned `jev-1.13.0`; a Jev outage or `packing_limit` degrades to today's behaviour (the Keeper chooses), never to a guess.

### D3. The loop (Stage 2)
`read → compile/route (fan-out over all live candidates incl. D1) → execute cleared candidates through the one operation gateway (§135.4; admission on compile evidence, §32.12) → re-route on the new state (a cleared `clue_follow_up` or `npc_reaction` may issue a `time_cost`; an executed move issues the next scene's D1 candidates) → exit`. `finish` hands the run's receipts (clerk did) and the carried views (§135.31) to the Keeper's compose step. Existing gates hold: the same question over the same candidates and material is never asked twice; after an LLM step the next step is direct or finish; `maxSteps`/Jev budget per run; §135.25's time budget.

### D4. Shadow first (Stage 2a), then execute (Stage 2b)
- **Shadow** (`COC_JEV_STEPS=shadow`, and the default until 2b is accepted): D1 candidates are routed and logged with `shadow: true` but never executed. After the turn closes, the host pairs each shadow decision with what the Keeper did in the same turn: a first-impression on the same NPC, an `apply clue` on the same handle, a time advance; rows `{lane: "route", shadow: true, class, key, cleared, keeper_did: true|false|other}`. Two tables (gates #13/#14 run it for free) give the agreement rate per class; the acceptance line for 2b is written in D6 before those tables run.
- **Execute** (`COC_JEV_STEPS=on`): cleared D1 candidates run as clerk steps; the Keeper's projection lists them under "clerk did" (§135.8) with the rules default line where one was taken; the Keeper reconciles in the fiction or reverses with a real operation (2026-09-23 ruling, unchanged). Residual telemetry per turn: `{lane: "residual", keeper_calls: {apply: n, resolve: n, look: n, recall: n}, compile_calls: n, clerk_calls: n}`.

**D4 ruling (owner, 2026-09-26):** execute mode is per class, the list is data (`jev_steps.execute`); `clue_follow_up` executes from SL-78, `npc_reaction` and `time_cost` stay shadow until their own report meets D6 2a.

### D5. Stage 3: narrator-only Keeper (SL-79, gated on D6)
When two consecutive tables show residual Keeper writes ≤ 3 per 20 turns and zero refused ones, the compose step's tool catalog becomes `narrate`, `ask`, `say`, plus one typed `propose` verb: a request for one more clerk step named by candidate key from the run's offered set (never a free handle), routed through the same admission. `apply`/`resolve`/`look`/`lookup`/`recall` leave the Keeper's catalog; the reading tools' work is the read step's (§135.6) and the carried views' (§135.31). A setting, default off until accepted.

### D6. Acceptance lines (pre-registered)
- 2a (shadow, gates #13/#14): per class, agreement with the Keeper ≥ 0.9 where the Keeper acted; false positives (Jev clears, Keeper did not, and the pairing reads as wrong on the transcript) ≤ 1 per table per class; Jev cost per turn ≤ 1.5 s added.
- 2b (execute, gate #15): Keeper-chosen `apply`+`resolve` ≤ 10 per table (from 30–33); `unknown_entity` on Keeper free calls = 0; refusal-budget cuts = 0; delivery 20/20; median wall ≤ 35 s; no first impression on a person the player only named; every executed D1 step appears in the prose or is reversed by the Keeper with a receipt (none silently ignored).
- 3 (narrator-only, gate #16+): delivery 20/20; median ≤ 30 s; `propose` used ≤ 3 per table; player-facing quality lines of the long-gate pre-registrations unchanged.

## Out of scope
The thinking-schedule experiment (SL-74) is a separate variable and runs on #14 alongside shadow. The Electron picker (SL-75). A second decision model. Any candidate that needs prose to exist.
