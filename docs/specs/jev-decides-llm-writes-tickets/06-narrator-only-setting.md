Status: ready-for-human
Spec: docs/specs/jev-decides-llm-writes.md D-D · Contract §150.5 · Ticket SL-79 (`pi-native-single-loop-tickets/79-narrator-only-keeper.md`)

# 06 — Narrator-only compose catalog as a setting (default off)

Implement SL-79's scope 1–4 behind a setting (env over data, default off). Before narrowing, read the SL-78 residual rows available in this checkout for the reads the Keeper still made and check §135.31's carried views cover them; record gaps as findings in this ticket (no prompt workaround).

Tests: default catalog unchanged; with the setting on, compose exposes exactly narrate/ask/say/propose, bind/adjudicate keep theirs; `propose` on an offered key executes through admission; on a free handle refuses with the offered keys; the per-turn cap refuses the N+1th; a settled run delivers prose with zero Keeper tool calls.

## Comments

### 2026-09-28 — the reads the Keeper still made (measured before narrowing)

Source: every retained campaign with `lane:"residual"` rows, read-only. None are in `chatrpgv4-wt-pi-coc-v2/.coc` itself and none in the PipiCOC App homes (they ran shadow); eleven are in the gate worktrees: long gates #17–#25 (`longgate17-haunting-0831` … `longgate25-haunting-0016`) and `masks2-2238`, `masks3-0017`. 209 residual rows (206 runs). Scripts: the Keeper's read tool rows (§135.31: `origin: "model"`, `run`, `step`, `args`), each attributed to the model step before its operate step (`step_end` of kind `infer`: purpose and reason), and the run's `carried` rows before it.

- Residual totals: apply 193, resolve 76, look 37, lookup 69, recall 0.
- Model steps: 121 compose (needs_player 39, settled 36, run_budget 22, turn_close:speech 14, turn_close:steer 4, finish 2, turn_close:audit-repair 2, turn_close:floor 2), 336 adjudicate, 0 bind; 92 of the 121 compose steps carried at least one tool call.
- **105 Keeper reads; 94 on adjudicate steps**, which keep their verbs under this setting (look scene 12, investigator 8, object 6, clues 3; lookup source/answer 30, module 26, rule 6, source/prepare 2, catalog 1). **11 on compose steps:**

| read | where | covered? |
| --- | --- | --- |
| `look npc` Steven Knott | lg17 t20, compose needs_player ("I go back to Knott's office and tell him everything") | no: present in the scene the move landed on, already met, named by no candidate |
| `look npc` Rat Pack | lg17 t16, compose settled (basement) | no: named by no candidate |
| `look npc` Lt. Martin Poole | masks3 t4, compose needs_player | no: named by no candidate (Colm Doyle, Iregi Kipkemboi, Jackson Elias were carried) |
| `look npc` the Hall of Records clerk | lg17 t4, compose needs_player | yes: carried earlier in the run |
| `look scene` | lg17 t6, compose needs_player | yes: carried earlier in the run |
| `look clues` ×2 | lg17 t6, t16 | yes: `look focus=clues` returns `{discovered_clues, clues_here}` from the same `cluesHere` the capsule's `known` section uses (`kernel-ts/read/handlers.ts`, `capsule.ts` `knownSection`), and the capsule is current through `coc-capsule-update` (§135.23) |
| `lookup source` answer "Corbitt House 1866 lawsuit, Hall of Records" | lg17 t4 | no: the scene's source passages were carried; the question was narrower |
| `lookup source` answer "corbitt-diaries" and `lookup module` "corbitt-diaries Corbitt Diaries" | lg18 t15, compose settled | no: same |
| `lookup source` answer "basement sealed boards trapdoor hatch floating knife Corbitt body" | lg22 t18, compose turn_close:steer | no: same |

**Findings (view gaps; not worked around in the prompt).**

1. **A present, already-met person whom no candidate names is not carried** (3 of 11). §135.31 carries a person only when a candidate of the run names them and says "whether a person present in a scene the run moved into should be carried is the owner's to rule". On a narrowed compose the Keeper voices such a person (Knott, in the turn the player spends talking to him) without their card: voice, wants, knows. Needs the owner's ruling on §135.31's open question (carry the present people's cards, or a closed subset of them), then a carried-views change; not in this ticket.
2. **The Keeper's own targeted question of the book** (4 of 11: three `lookup source` answers and one `lookup module`). The read step carries the scene's passages the prescreen located for the player's input; `read_more` is Jev's exit, and `propose` covers clerk writes only. A narrowed compose has no path for a question the Keeper forms while writing. Options for the owner: a read candidate family `propose` could name, or leaving these to the adjudicate step; not in this ticket.
3. Covered (4 of 11): `look clues` ×2 by the capsule, one `look scene` and one `look npc` already carried in the same run. No gap; the Keeper repeated a read.

**Writes on compose steps (for D6 3's `propose` ≤ 3 per table, not a view gap).** 65 Keeper writes (51 apply, 14 resolve) on the 121 compose steps; 64 matched to their receipts: 14 refused, 50 landed. Receipt kinds among the landed: time 25, npc (intents, dispositions) 15, person 13, first impression 9 (`roll` natural-npc:first-impression, offered to `propose` through the `npc_reaction` candidate, whose closed `intent` the policy's bind runs), move 6, handout 6, definition/item 5, note 5, clue 4, threat 1, cash 1. Many kinds have no issuable candidate (npc intents, notes, invented items, cash, a walk-on person), so on a narrowed compose they are simply not written; the landed ones average about 4.5 per table against D6 3's `propose` ≤ 3. That is the owner's reading at the D6 3 gate; nothing here changes it.

### 2026-09-28 — implementation (branch `claude/jev-reach-20260928-06-narrator-only`)

What changed (contract first: §150.5 gains an "Implementation decision" paragraph; spec D-D is unchanged):

- `content/rulesets/coc7/host-budgets.json`: `narrator_only: {enabled: false, propose_per_turn: 2}`; `runtime/jev/host-budgets.ts`: `narratorOnlyBudget()`.
- `runtime/jev/narrator-catalog.ts` (new, pure): the setting (`COC_NARRATOR_ONLY` on/off over the data), `stepCatalog` (which step narrows), `offeredForPropose`, `proposedCandidate`, the refusal sentences, the `propose` tool declaration and the notes.
- `runtime/jev/hybrid-engine.ts`: the note carries `catalog`/`catalog_note` on a narrowed compose, `offered`/`propose_note` where `propose` is admitted, and a `catalog` row; `modelStep` announces a refusal on `coc:model-step` for a verb outside the narrowed catalog and for anything after an accepted `propose` in the same response; `proposeStep` validates and queues (rows `event: propose`); the registered `propose` tool returns what the run settled; `propose` is registered and activated only while the setting is on and only on a play surface; the consequence route never executes a proposed key; the `residual` row gains `propose_calls` while on.
- `runtime/jev/step-policy.ts`: a queued `propose` becomes the policy's own items (`itemsFor`, reason `proposed`) and then a compose; a narrowed compose's fallen batch returns to the compose once (`narrator_fallen`), a second fall stops the run; `Candidate.key`'s comment names the one place a key reaches the model.
- `extensions/kernel/index.ts`: `coc:model-step` keeps `refuse`/`refuse_code`; the tool gate blocks such a model call right after the closed-turn door, before admission, a call id or a kernel read, with the engine's sentence, and strikes no refusal class.

Decisions (recorded in §150.5):

- The catalog is what the step admits; the provider-visible loadout stays the session's. A per-step loadout would re-declare 67 KB of tool definitions into the transcript at every compose/adjudicate switch and move the tool prefix. The cost of this choice: the model still sees `apply` and co. on a narrowed compose and can spend a round on a refusal; the `narrator_catalog` blocked rows and `catalog_refused` rows count that at the table.
- `say` is the `{{say:Name}}…{{/say}}` span, not a tool: the narrowed catalog is `narrate`, `ask`, `propose`.
- `propose` queues rather than executing inside the model call, so a closed parameter (the first impression's `intent`, a check's skill) is bound by the policy's own bind step, and the proposal goes through exactly the clerk's path (gateway, admission). Its basis carries `proposed: {by: "keeper"}` and never a compile's or consequence route's evidence, so admission reviews it as the Keeper's request. After an accepted `propose` the rest of that response is refused (`propose_pending`), because the proposed step has not run.
- `propose` is admitted on compose and adjudicate steps (the tool is declared session-wide anyway; on adjudicate it adds a key-bound path and removes nothing), refused on a bind step. N = 2 per kernel turn (data): enough for a clue and its time cost; D6 3's per-table line is what the table measures.
- A narrowed compose does not narrow on a Jev outage, nor on the spent-decision-budget compose (§135.25 hands that turn's rest to the Keeper's own calls).
- A narrowed compose that falls returns to the compose once, never to the adjudicate (whose catalog would reopen the narrowed verbs).

Tests (all run on this Mac, single files):

- `tests/extension/single-loop-narrator-only.test.mjs` — 14/14 pass. Engine seam (stub decision port and gateway) and policy seam (`createStepPolicy`).
- `tests/extension/single-loop-narrator-gate.test.mjs` — 2/2 pass. Needs the emitted build (`tests/extension/pi.mjs` → `build/`); run here once against a temporary read-only link to `chatrpgv4-wt-pi-coc-v2/build` (its `vendor/pi` is identical to this branch's), link removed afterwards.
- Regression, single files: `single-loop-run-driver` 4/4, `single-loop-turn-close` 15/15, `single-loop-binding` 25/25, `single-loop-band-clerk` 6/6, `consequence-candidates` 19/19, `consequence-host-budgets` 13/13, `consequence-route` 11/11, `consequence-shadow-gate` 9/9, `consequence-execute-mode` 9/9, `consequence-residual-pairing` 7/7, `gates` 12/12, `system-language` 5/5.

Mutation checks (file copied aside, mutated, test run, copied back; never `git checkout --`), every one killed: no narrowing; the engine not refusing outside the catalog; a free handle not refused; no per-turn cap; the policy not queueing a propose; a narrowed fall going to the adjudicate; `propose` registered while off; the data's `enabled` ignored; the route free to re-execute a proposed key; the proposed basis keeping Jev evidence; no consequence-twin dedupe; the rest of a response not held after a propose; `propose` admitted on bind; open parameters offered; an outage still narrowing; the residual row without `propose_calls`; and, on the session test, the kernel gate ignoring the announcement and the announcement dropping `refuse`. One survived on the session test only: removing the engine's explicit activation of `propose` (Pi's registry refresh already activates a tool registered after bind); the engine-seam test kills it.

Not done / open:

- The two view gaps above (findings 1 and 2) need the owner's rulings; the setting stays off, and D6 3 stays the gate for turning it on.
- `tests/play/jev-steps-report.py` does not yet read the `catalog`, `propose` and `catalog_refused` rows or the residual's `propose_calls`; D6 3's `propose` ≤ 3 per table is countable from the `propose` rows today.
- No live table was run (none is in this ticket's scope); the model's behaviour against a catalog it can see but not use is what the first narrator-on table will measure.
