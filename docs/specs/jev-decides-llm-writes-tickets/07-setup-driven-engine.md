Status: ready-for-human
Spec: docs/specs/jev-decides-llm-writes.md D-E · Contract §150.6
Load the `typesafe-jev` skill first.

# 07 — Setup runs on the driven engine

Scope E1–E6: engine selection for setup; `coc-setup-v1` policy and setup ports (read / decide / operate / infer / finish) on the vendored RunDriver, launched like `pi-hybrid` but never using the play policy; `setup-input-route` and `setup-card-fields` families; direct execution through the existing setup step executor; narrowed bind tool; compose without tools; adjudicate with today's full `setup` tool; outage/budget/refusal fallback; telemetry; inventory entries. Confirm is never Jev's.

Tests at the setup seams (fake decision adapter, fake model steps): a stated catalog occupation binds without a model call; a trade outside the catalog binds the closest catalog occupation and copies the player's words to `occupation_stated`; named skills bind by Noul; unstated numbers use kernel defaults; open fields go through the narrowed bind tool, which refuses closed keys; a question routes to adjudicate with the full tool; a Jev outage runs today's legacy-equivalent path; `setup.confirm` is never issued by the policy.

## Comments

### 2026-09-28 implementation (worker, branch `claude/jev-reach-20260928-07-setup-driven`)

Contract first: §150.6 gained an "Implementation decision" block (engine and entry, one executor, per-step catalogs, route moves, card fields, gates, telemetry, known limit). What changed:

- **Engine selection** (`runtime/loop-engine.ts`): setup is `hybrid-v1` when `PI_COC_LOOP_ENGINE` is unset or `hybrid-v1`, a Jev key is readable and no S0/TaskRuntime flag is set; otherwise legacy (explicit `legacy`, no key, or explicit `hybrid-v1` without a key). The launcher already hands the child `PI_COC_LOOP_ENGINE`, so the startup record reports `loop_engine: "hybrid-v1"` with `mode: "setup"` and `driver.py --launcher bin/pi-coc-setup --expect-engine hybrid-v1` works without a driver change. `run_start` names policy `coc-setup-v1`.
- **Entry** (`runtime/pi-hybrid.ts`): `hybridMainOptions(env)` builds the setup engine for `PI_COC_MODE=setup` and the play engine otherwise; setup never reaches the play policy. No new emitted entry.
- **Families** (`runtime/jev/setup-decisions.ts`, pure): `setup-input-route` v1 (one Noul per legal move, exit Choice `continue | ask_llm | none_of_above`, target Choices for source/opening/library, `language_change` Noul beside `choose_source`); `setup-card-fields` v1 (occupation Choice + `not_stated`, `occupation_stated` and `occupation_outside` Nouls, era Choice when the rulebook lists more than one period, `strong`/`weak` Choices over the catalog's characteristics, one Noul per listable catalog skill, `stated_*` Nouls per open field, `delegated`, `numbers`, `removal`). Gates are data: `setup_driven` in `content/rulesets/coc7/host-budgets.json`. `cardPlan` turns the answers into direct / bind / compose / adjudicate.
- **Engine** (`runtime/jev/setup-engine.ts`): policy `coc-setup-v1` + ports. Read = the onboarding port's `read()`; decide = the two families under a TaskLease scoped to the campaign (or `setup-session:<id>` before one exists); operate = a route move or a closed-field `revise` through the onboarding executor, plus the model's calls; infer = `bind` (only `setup_card`), `compose` (no tool), `adjudicate` (full `setup`, looping like the model-first loop up to 24 steps). The per-step catalog is set on the session and projected onto the request by a `context_with_system` handler (the §128.1 pattern), because the RunDriver fixes the first request's tools at run start. Telemetry: `coc-telemetry` rows `lane: "setup"` (`decide` per family, `run` per run).
- **Onboarding** (`extensions/onboarding/index.ts`): publishes `coc:setup-executor` at session start (`execute` = the setup tool's own executor, `read`, `move`, `copy`); the catalog fetch became `loadCatalog()` (same text, now also kept as rows); `continueSource`/`setupMove` run a cleared move as `execute` calls. The legacy engine never subscribes; its prompt, tool surface and preflight are unchanged (setup.test.mjs 25/25, source-intake, opening-choice, handoff, player-reasons all green).
- **Host copy** (`runtime/jev/setup-input-references.ts`): `copySetupInputSelection` copies the player's words for `occupation_stated` from an issued alias range (same word trim as a name, no Jev).
- **Kernel** (`kernel-ts/setup/catalog.ts`, `sheet.ts`, `drafts.ts`): `setup.catalog` also returns `characteristics: [{abbr, name}]` and marks `listed: false` on Credit Rating and Cthulhu Mythos; `NOT_LISTED_SKILLS` replaces the two literal copies of that pair in drafts/catalog. No behaviour change otherwise; `tsc -p tsconfig.kernel.json` clean.
- **Inventory**: `runtime/jev/setup-engine.ts#createSetupEngine#createDecisionAdapter` added to `inventory-SL-00.json`/`.md` (app-setup leaf, families, budget, gate, fallback).

Decisions recorded in §150.6 (the ones the spec left open):
1. Moves are selected by their own Nouls (D2.1); two cleared moves go to the Keeper (`several_moves`); the exit gets a `continue` option so it is not forced onto the two exits when a move applies (D2.2).
2. A first card always binds (the kernel needs name, sex, concept, own_language, backstory, key_connection, equipment); no trade bound → compose (ask) unless `delegated` → adjudicate; no name and not delegated → compose.
3. Named skills: first card → `occupation_skills` in Noul order (the profile's own contract); drawn card → listed ones to the front of their list, unlisted ones to the front of `interest_skills`.
4. Stated numbers and removals adjudicate in v1 (no number is copied from the input yet).
5. `approve_card` is a route move whose execution is adjudicate: the Keeper confirms with the full tool; the policy has no confirm operation.
6. `weapons` names are open in `setup_card` (the kernel keeps printed profiles as weapons, anything else as equipment).

Tests (all single files, this Mac):
- `tests/extension/setup-driven-engine.test.mjs` 12/12 — seam cases: trade outside the catalog → closest catalog occupation + host-copied `occupation_stated` + skills in Noul order + no numbers sent + tools `[setup_card]` then `[]`; catalog occupation on a drawn card → one direct `revise`, one model request with no tool; open field on a drawn card → `setup_card` refuses a closed key with `open_keys`/`bound`, nothing executed, next request has the full tool; a question → adjudicate with `[setup]` and no card-field decision; Jev outage and no Jev → today's full-tool path with no step note; approval → full tool, no `setup.confirm`; listed starter → `choose-source` + `create-campaign` then one tool-less reply; engine selection and `hybridMainOptions`; D2 batch shape and packing at the real catalog's size; `cardPlan` and `interpretRoute` units.
- `tests/extension/ts-kernel-setup-catalog.test.mjs` 1/1 — bundled TS kernel, `setup.catalog` characteristics and `listed: false`.
- `tests/extension/launch.test.mjs` — the "setup always legacy" case rewritten for §150.6 (driven with a key; legacy without one or with explicit legacy); 13/15 here, the 2 failures need the full emitted runtime (`build/extensions/...`) and an unrelated `module.reference.status` expectation — both fail the same way without this change.
- `tests/extension/hybrid-source-wiring.test.mjs` 2/2 (setup-with-key assertion updated to `hybrid-v1`).
- Regression: `setup.test.mjs` 25/25, `setup-source-intake` 2/2, `setup-opening-choice` 5/5, `setup-handoff-and-guidance-retry` 9/9, `setup-player-reasons` 4/4, `jev-setup-input-references` 8/8, `control-flow-inventory` 4/4, `single-loop-run-driver` 4/4, `card-patch` 4/4, `system-language` 5/5, `ui-words` 9/9.

Mutation checks (file copied aside, mutated, test run, copied back): 19 mutations, all killed — no catalog projection, no host copy, no closed-key refusal, exit composes, direct becomes bind, setup always legacy, approve composes, skill order reversed, numbers not adjudicated, unlisted skills offered, setup gets the play engine, outage composes, no source continuation, language change ignored, wrong opening target, several moves take the first, exit selects a move, no `listed` mark, no characteristics.

Not done / for the lead:
- Full suites on the box (`test:ext`, pytest). `tests/kernel/test_setup_card.py` / `test_setup_drafts.py` cover the kernel refactor through the emitted kernel and need `build:runtime` first.
- `pick_opening` and `load_library` have unit coverage only (the fake kernel has no `investigator.load`, and an opening choice needs the PDF/module preparation path).
- No live table: acceptance is ticket 08 (cold Blood PDF through `driver.py --launcher bin/pi-coc-setup --expect-engine hybrid-v1`). Gate numbers in `setup_driven` are starting values to calibrate on that table.
- Known limit (§150.6 decision 8): a delegated card gets no interest skills the player did not name; the card reports interest points left. Owner decision whether to add a per-skill "fits the concept" family.

### 2026-09-28 addendum: `setup-interest-fit` v1 (lead ruling on the delegated-skills limit)

The lead ruled that the known limit is a regression against legacy and that picking interest skills is a closed-set decision, so it goes to Jev. It is recorded as §150.6 decision 9 (decision 8 marked superseded, decision 6 and §150.7 amended) and in the SL-00 inventory note.

**When it runs.** Only when the player delegated the card or its skills. That is the card-fields family's `delegated` Noul or a new `delegated_skills` Noul. The card must also still have interest points left once written, taken from the kernel's `budget.interest.unspent` on a fresh read.

**Order.** No extra model request is added:
1. The bind step writes the open words.
2. The fit is asked.
3. One direct `revise` sets `interest_skills` with `auto_spread: true`.
4. Compose writes the reply.

On a card already drawn, delegated skills alone go straight to the fit.

**Question shape.**
- **State (D2.3).** The card's occupation (and `occupation_stated`), concept, backstory and era.
- **Candidates.** Listable catalog skills minus the card's own lists minus the occupation's printed skills.
- **Questions.** One Noul per candidate, with the ruling's wording, plus one `exists` Noul.
- **Packing.** A batch too large to pack is split into several requests of the same fan-out. `exists` rides on the first; keys stay globally unique.

**Selection is code.** Skills whose Noul clears the family's gate, strongest first, up to `interest_skill_max`. They follow any interest skills already on the card. Nothing is picked unless `exists` clears. The kernel spreads the points.

**When nothing is picked.** Nothing cleared, an outage, a packing refusal and a spent budget all leave the card unchanged. The compose note carries `interest` (status, points left) and tells the Keeper the points remain. No model fallback picks skills.

**Data (`setup_driven`).** `max_decisions` is now 3 (route, card fields, interest fit). New keys: `interest_row_min` 0.5, `interest_row_ratio` 2, `interest_skill_max` 6.

**Telemetry.** The family writes a `decide` row, including `status: "not_asked"` with the reason when it was due but asked nothing. `bound` gains `interest_skills` with path `jev`.

**Other changes.**
- The onboarding read now carries each occupation's printed skills and the card's era.
- The fake kernel now leaves the interest pool unspent when a card lists no interest skills, as the real kernel does.

**Tests.** `tests/extension/setup-driven-engine.test.mjs` is now 17/17. New cases:
- A delegated card gets the cleared skills in probability order, capped by data. That means one direct revise with `auto_spread`, candidates that exclude listed, printed and unlisted skills, and no extra model request.
- Nothing cleared leaves the points unspent, makes no revise, and the note says the points remain.
- A non-delegated card never asks the family.
- An outage leaves the card unchanged and does not fall back to the model.
- Pure checks: candidate set, packing split with `exists` on the first batch only, the gate and cap coming from data, `exists` required, and the `interest` plan kind.

Test 1 now expects the three families.

**Mutation checks.** 11 mutations, all killed: no cap, reversed order, no auto spread, empty set revised, family always asked, printed skills offered, listed skills offered, outage falls back to the model, no `exists` gate, `exists` on every batch, and the non-delegated case run alone.

**Regression.** setup 25/25, source-intake 2/2, opening-choice 5/5, handoff 9/9, player-reasons 4/4, card-patch 4/4, control-flow-inventory 4/4, system-language 5/5, ts-kernel-setup-catalog 1/1, hybrid-source-wiring 2/2.

**For the box.** The same test list as before.

**Open.** `interest_skill_max` and the fit gate are starting values, to be calibrated on ticket 08's table.
