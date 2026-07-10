# COC Keeper Full Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 34 acceptance items in the approved full-hardening design, including release governance, canonical live subsystem wiring, Director/Narration state feedback, runtime safety/productization, evidence provenance, performance, CI, and diagnosis cleanup.

**Architecture:** Preserve `run_live_turn` as the canonical entry point and add typed, stateful boundaries around it: a subsystem executor, graph-aware outcome model, evidence receipts, merged Director state, structured narration audit, and a safe runtime state/session layer. Existing standalone engines remain authoritative; the plan wires them into production rather than duplicating their rules.

**Tech Stack:** Python 3.11–3.13, pytest, JSON/JSONL contracts, Node.js ES modules, Pi Coding Agent adapters, GitHub Actions, Codex plugin manifests.

## Global Constraints

- `plugins/coc-keeper/` remains the sole canonical plugin track.
- Runtime meaning must come from structured fields or semantic-router evidence with recorded reasons; no new free-text keyword classification.
- Rules math remains deterministic and must not be delegated to an LLM.
- Scripted fixtures and formatter samples must never be labeled gameplay battle reports.
- Do not push, deploy, tag, publish, rewrite Git history, or make legal conclusions.
- Use `0.16.0-alpha.1` consistently for all manifests and marketplace metadata.
- Every behavior task follows red-green TDD and must verify the canonical path, not only a standalone engine.
- Workers must not revert unrelated changes and must write a handoff under `.tmp/team-lead/`.

## File and Ownership Map

| Area | Primary files | Sole-owner rule |
|---|---|---|
| Release/CI/docs | `.github/workflows/tests.yml`, `README.md`, `CHANGELOG.md`, manifests, `CONTENT_LICENSES.md` | One worker owns shared narrative files. |
| Live match/evidence | `coc_live_match.py`, new `coc_playtest_evidence.py` | One worker owns `coc_live_match.py` until Task 4 is accepted. |
| Canonical subsystem execution | new `coc_subsystem_executor.py`, `coc_live_turn_runner.py`, `coc_playtest_driver.py` | Tasks 5–8 execute serially. |
| Director/NPC | `coc_story_director.py`, `coc_scenario_compile.py`, `coc_narrative_enrichment.py`, `coc_director_apply.py` | Tasks 9–10 execute serially. |
| Narration | `coc_narration_contract.py`, `coc_narration_style.py`, new `coc_secret_audit.py`, narrator adapter | Task 11 owns this surface. |
| Runtime | `runtime/engine/`, `runtime/sdk/`, runtime adapters | Tasks 12–14 execute serially. |
| Final audit | status/diagnosis docs and complete validation | Lead-owned after worker handoffs. |

## Execution Graph

```text
Task 1 ─────────────────────────────────────────────┐
Task 2 → Task 3                                    │
Task 4                                             │
Task 5 → Task 6 → Task 7 → Task 8                  ├→ Task 15
Task 9 → Task 10 → Task 11                         │
Task 12 → Task 13 → Task 14                        │
                                                    ┘
```

Tasks on separate rows may run in parallel only when their file scopes do not overlap. Tasks on the same arrow chain are serialized.

---

### Task 1: Release hygiene, version governance, CI, and current documentation

**Acceptance:** A01, A02, A03, A04, A05, A06

**Files:**
- Modify: `.gitignore`
- Modify: `.github/workflows/tests.yml`
- Create: `CONTENT_LICENSES.md`
- Create: `docs/status/CURRENT.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-07-10-next-phase-optimization-audit.md`
- Modify: `plugins/coc-keeper/.codex-plugin/plugin.json`
- Modify: `plugins/coc-keeper/.claude-plugin/plugin.json`
- Modify: `plugins/coc-keeper/.cursor-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Remove from HEAD: `checks/ocr-cached/**`, `checks/py4llm-cached/**`
- Test: `tests/test_plugin_metadata.py`
- Test: new `tests/test_release_consistency.py`

**Interfaces:**
- Produces: `docs/status/CURRENT.md` as the only live status source.
- Produces: version constant-by-contract `0.16.0-alpha.1` across manifests.
- Produces: CI jobs `python`, `plugin-metadata`, `node-adapters`, `product-smoke`.

- [ ] **Step 1: Write failing release consistency tests**

```python
def test_release_version_is_consistent():
    assert all(v == "0.16.0-alpha.1" for v in manifest_versions())

def test_readme_matches_packaged_starters():
    assert documented_starter_count() == packaged_starter_count()

def test_rulebook_extracts_are_not_tracked():
    assert tracked_extract_paths() == []
```

- [ ] **Step 2: Run the tests and confirm the current drift fails**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_release_consistency.py tests/test_plugin_metadata.py -q -p no:cacheprovider`

Expected: failures for version, starter count, and tracked extraction caches.

- [ ] **Step 3: Remove generated extracts and add ignore rules**

Add these exact ignore entries:

```gitignore
checks/ocr-cached/
checks/py4llm-cached/
```

Remove the tracked files from HEAD without rewriting history.

- [ ] **Step 4: Add the content inventory**

Use this row schema in `CONTENT_LICENSES.md`:

```markdown
| Asset group | Repository path | Source | Distribution basis | Status | Notes |
|---|---|---|---|---|---|
| The White War starter | `plugins/coc-keeper/references/starter-scenarios/the-white-war/` | Cthulhu Reborn OGL package | Bundled OGL and Section 15 notice | DOCUMENTED | No source PDF included. |
| The Haunting starter | `plugins/coc-keeper/references/starter-scenarios/the-haunting/` | Original derivative pack inspired by classic structure | Repository attribution only | UNVERIFIED | Requires external rights review before stable release. |
```

Include rule JSON, logos/images, generated extracts, and Node/Python dependencies.

- [ ] **Step 5: Normalize version and current-status documentation**

Set all manifest/marketplace versions to `0.16.0-alpha.1`. Update README to list both starters. Replace CHANGELOG's “uncommitted worktree” prose with committed post-tag changes. Add this banner to historical audit documents:

```markdown
> **HISTORICAL — DO NOT EXECUTE.** Current status lives in `docs/status/CURRENT.md`.
```

- [ ] **Step 6: Expand CI into explicit jobs**

The Python job must install `pytest pypdf` and use matrix `3.11`, `3.12`, `3.13`. Node jobs run `npm ci` for every adapter with a lockfile and execute Python contract tests. Product smoke runs quick start → four turns → state reload → one continued turn.

- [ ] **Step 7: Verify release checks**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_release_consistency.py tests/test_plugin_metadata.py tests/test_starter_scenarios.py tests/test_runtime_sdk_debug.py -q -p no:cacheprovider
```

Expected: all pass and `git ls-files 'checks/ocr-cached/**' 'checks/py4llm-cached/**'` prints nothing.

- [ ] **Step 8: Commit the scoped task**

```bash
git add .gitignore .github/workflows/tests.yml CONTENT_LICENSES.md docs/status/CURRENT.md README.md CHANGELOG.md docs/superpowers/specs/2026-07-10-next-phase-optimization-audit.md plugins/coc-keeper/.codex-plugin/plugin.json plugins/coc-keeper/.claude-plugin/plugin.json plugins/coc-keeper/.cursor-plugin/plugin.json .claude-plugin/marketplace.json tests/test_release_consistency.py tests/test_plugin_metadata.py checks/ocr-cached checks/py4llm-cached
git commit -m "chore(release): harden content version and CI governance"
```

---

### Task 2: Live investigator outcomes and graph-aware termination

**Acceptance:** A07, A08

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_live_match.py`
- Modify: `plugins/coc-keeper/scripts/coc_playtest_driver.py`
- Modify: `plugins/coc-keeper/scripts/coc_scene_graph.py`
- Test: `tests/test_live_match.py`
- Test: `tests/test_playtest_driver.py`

**Interfaces:**
- Produces: `investigator_playability(campaign_dir: Path, investigator_id: str) -> dict[str, Any]`.
- Produces: `terminal_evidence(story_graph, world_state, events) -> dict[str, Any]`.

- [ ] **Step 1: Add failing outcome tests**

```python
def test_dying_investigator_enters_rescue_resolution_not_dead(tmp_path):
    result = run_match_with_state(tmp_path, hp=0, conditions=["major_wound", "dying"])
    assert result["stop_reason"] != "investigator_dead"
    assert result["pending_resolution"]["kind"] == "dying_rescue"

def test_unconscious_without_dead_condition_does_not_report_death(tmp_path):
    result = run_match_with_state(tmp_path, hp=0, conditions=["unconscious"])
    assert result["stop_reason"] != "investigator_dead"
```

- [ ] **Step 2: Add failing branching-terminal tests**

Create a graph whose terminal scene is not the last array element and assert `reached_terminal is True`; create a nonterminal last-array scene with an outgoing edge and assert `False`.

- [ ] **Step 3: Implement structured investigator playability**

```python
def investigator_playability(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    state = load_investigator_state(campaign_dir, investigator_id)
    conditions = {str(v).lower() for v in state.get("conditions", [])}
    if "dead" in conditions:
        return {"status": "dead", "terminal": True}
    if "dying" in conditions:
        return {"status": "dying", "terminal": False, "pending_resolution": {"kind": "dying_rescue"}}
    if "unconscious" in conditions or int(state.get("current_hp", 1)) <= 0:
        return {"status": "unconscious", "terminal": False}
    return {"status": "active", "terminal": False}
```

- [ ] **Step 4: Replace array-position terminal reporting**

Use `coc_scene_graph.is_terminal_scene(active_scene, story_graph)` and structured `session_ending` evidence in both live match and driver. Keep array order only inside `derive_scene_edges` legacy compilation.

- [ ] **Step 5: Run focused tests**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_live_match.py tests/test_playtest_driver.py tests/test_scene_graph.py -q -p no:cacheprovider`

Expected: all pass, including non-last terminal cases.

- [ ] **Step 6: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_live_match.py plugins/coc-keeper/scripts/coc_playtest_driver.py plugins/coc-keeper/scripts/coc_scene_graph.py tests/test_live_match.py tests/test_playtest_driver.py
git commit -m "fix(playtest): use structured outcomes and terminal evidence"
```

---

### Task 3: Evidence-grade battle-report provenance

**Acceptance:** A09, A10

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_playtest_evidence.py`
- Modify: `plugins/coc-keeper/scripts/coc_live_match.py`
- Modify: `plugins/coc-keeper/scripts/coc_playtest_report.py`
- Test: new `tests/test_playtest_evidence.py`
- Test: `tests/test_live_match.py`

**Interfaces:**
- Produces: `build_evidence_receipt(run_dir: Path, provenance: dict[str, Any]) -> dict[str, Any]`.
- Produces: `write_evidence_receipt(run_dir: Path, receipt: dict[str, Any]) -> Path`.

- [ ] **Step 1: Replace the defect-enshrining test with a failing rejection test**

```python
def test_live_flag_cannot_make_scripted_runner_evidence_eligible(tmp_path):
    result = run_scripted_match(tmp_path, live=True)
    assert result["metadata"]["user_claimed_live"] is True
    assert result["metadata"]["eligible_as_gameplay_evidence"] is False
    assert "runner_not_attested" in result["metadata"]["evidence_reasons"]
```

- [ ] **Step 2: Add receipt schema and hashing tests**

Assert stable SHA-256 for runner bytes, transcript, and event logs; assert missing runner/model/external-turn evidence fails closed.

- [ ] **Step 3: Implement evidence computation**

```python
def eligible(provenance: dict[str, Any]) -> tuple[bool, list[str]]:
    reasons = []
    if provenance.get("runner_attested") is not True:
        reasons.append("runner_not_attested")
    if int(provenance.get("external_model_turns", 0)) < 1:
        reasons.append("no_external_model_turns")
    if not provenance.get("transcript_sha256"):
        reasons.append("transcript_hash_missing")
    return (not reasons, reasons)
```

The CLI boolean populates `user_claimed_live` only.

- [ ] **Step 4: Write `evidence.json` before report generation**

Include schema version, timestamps, player/narrator runner identities, models, external turns, fallback turns, hashes, eligibility, and reasons. The report reads the receipt instead of inferring evidence from metadata strings.

- [ ] **Step 5: Run adversarial tests**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_playtest_evidence.py tests/test_live_match.py tests/test_playtest_report.py -q -p no:cacheprovider`

Expected: fake runners remain ineligible with `live=True`; attested fixtures with complete receipts are eligible.

- [ ] **Step 6: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_playtest_evidence.py plugins/coc-keeper/scripts/coc_live_match.py plugins/coc-keeper/scripts/coc_playtest_report.py tests/test_playtest_evidence.py tests/test_live_match.py
git commit -m "feat(playtest): derive gameplay evidence from provenance receipts"
```

---

### Task 4: Environment-aware action time

**Acceptance:** A11

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`
- Modify: `plugins/coc-keeper/references/rules-json/time-costs.json`
- Test: `tests/test_story_director.py`
- Test: `tests/test_live_turn_runner.py`
- Modify: `docs/live-playtest-notes.md`

**Interfaces:**
- Produces: `_time_profile_for_action(action: str, ctx: dict[str, Any]) -> dict[str, Any]`.

- [ ] **Step 1: Add a failing cold observation test**

```python
def test_reveal_quick_observation_in_extreme_cold_uses_short_profile():
    ctx = director_context(scene_tags=["extreme_cold"], intent_detail="quick_observation")
    profile = _time_profile_for_action("REVEAL", ctx)
    assert profile["category"] == "quick_observation"
    assert profile["delta_minutes"] <= 5
```

- [ ] **Step 2: Add a control test for deliberate room search**

An authored `time_profile.category == "single_room_search"` must remain 20 minutes even in cold scenes.

- [ ] **Step 3: Implement structured selection**

Priority is authored scene/action profile, then structured intent detail, then action default. Do not scan player prose. `REVEAL` with `quick_observation` uses the existing `quick_observation` category; full search keeps `single_room_search`.

- [ ] **Step 4: Verify and close the live note**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_story_director.py tests/test_live_turn_runner.py tests/test_time.py -q -p no:cacheprovider`

Update the note to `Fixed` with the regression test name.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper/references/rules-json/time-costs.json tests/test_story_director.py tests/test_live_turn_runner.py docs/live-playtest-notes.md
git commit -m "fix(director): distinguish cold observation from room search"
```

---

### Task 5: Stateful subsystem executor foundation

**Acceptance:** Foundation for A12, A13, A14, A15, A16

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_subsystem_executor.py`
- Modify: `plugins/coc-keeper/scripts/coc_live_turn_runner.py`
- Modify: `plugins/coc-keeper/scripts/coc_playtest_driver.py`
- Test: new `tests/test_subsystem_executor.py`
- Test: `tests/test_live_turn_runner.py`

**Interfaces:**
- Produces: `SubsystemCommand` JSON shape `{command_id, kind, phase, payload}`.
- Produces: `SubsystemResult` JSON shape `{command_id, kind, status, events, pending_choice, state_refs}`.
- Produces: `execute_commands(campaign_dir, character_path, investigator_id, commands, *, rng) -> list[dict[str, Any]]`.

- [ ] **Step 1: Add failing dispatch/idempotency tests**

```python
def test_executor_persists_pending_choice_and_replays_idempotently(tmp_path):
    result1 = execute(command("push_offer"), tmp_path)
    result2 = execute(command("push_offer"), tmp_path)
    assert result1 == result2
    assert result1["pending_choice"]["choice_id"] == "cmd-1:confirm"
```

- [ ] **Step 2: Define typed validation and persistence paths**

Use `save/subsystem-state.json` with `schema_version`, `applied_command_ids`, and `pending_choices`. Invalid command kinds raise a typed executor error before state mutation.

- [ ] **Step 3: Move ordinary request execution behind the executor**

The first implementation supports existing skill, characteristic, opposed, SAN, and Idea requests by adapting them into commands. Keep `_execute_rules_requests` as a compatibility wrapper that delegates to `execute_commands`.

- [ ] **Step 4: Wire the canonical live runner**

`coc_live_turn_runner` calls the executor and passes normalized results to `apply_plan`. Return `pending_choice` and `subsystem_results` in the live result.

- [ ] **Step 5: Verify compatibility**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_subsystem_executor.py tests/test_live_turn_runner.py tests/test_playtest_driver.py tests/test_director_apply.py -q -p no:cacheprovider`

- [ ] **Step 6: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_subsystem_executor.py plugins/coc-keeper/scripts/coc_live_turn_runner.py plugins/coc-keeper/scripts/coc_playtest_driver.py tests/test_subsystem_executor.py tests/test_live_turn_runner.py
git commit -m "refactor(rules): add canonical stateful subsystem executor"
```

---

### Task 6: End-to-end SAN bouts and Pushed Rolls

**Acceptance:** A12, A13

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_subsystem_executor.py`
- Modify: `plugins/coc-keeper/scripts/coc_sanity.py`
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`
- Modify: `plugins/coc-keeper/scripts/coc_director_apply.py`
- Test: `tests/test_subsystem_executor.py`
- Test: `tests/test_live_turn_runner.py`
- Test: `tests/test_sanity_session.py`

**Interfaces:**
- Consumes: Task 5 `SubsystemCommand` and `SubsystemResult`.
- Produces: pending choice kinds `push_confirm` and `bout_keeper_action`.

- [ ] **Step 1: Add failing multi-turn SAN tests**

Turn 1 triggers temporary insanity and stores bout rounds/involuntary action. Turn 2 executes `bout_tick`, records Keeper control, and decrements rounds. Final tick emits `bout_ended` and returns control.

- [ ] **Step 2: Add failing multi-turn push tests**

```python
def test_push_requires_changed_method_announced_consequence_and_confirmation(live_campaign):
    offered = run_live_turn(live_campaign, "retry", intent_class="investigate")
    assert offered["pending_choice"]["kind"] == "push_confirm"
    rejected = resume_choice(live_campaign, offered, confirmed=False)
    assert rejected["subsystem_results"][-1]["status"] == "cancelled"
```

Add a confirmed failure test that emits `pushed_roll_failure` and the announced consequence.

- [ ] **Step 3: Implement SAN command handlers**

Pass structured `alone`, `involuntary_kind`, and module overrides to `SanitySession.sanity_check`. Add explicit `bout_tick` and `bout_end` handlers that call the existing session methods and persist the snapshot.

- [ ] **Step 4: Implement push state machine**

Persist original roll ID, skill, changed method evidence, announced consequence, and confirmation. Only `push_resolve` rolls again. Reject incomplete gates without mutating the original result.

- [ ] **Step 5: Verify canonical wiring**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_subsystem_executor.py tests/test_live_turn_runner.py tests/test_sanity_session.py tests/test_director_apply.py -q -p no:cacheprovider`

- [ ] **Step 6: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_subsystem_executor.py plugins/coc-keeper/scripts/coc_sanity.py plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper/scripts/coc_director_apply.py tests/test_subsystem_executor.py tests/test_live_turn_runner.py tests/test_sanity_session.py
git commit -m "feat(rules): wire sanity bouts and pushed rolls into live turns"
```

---

### Task 7: End-to-end combat, wounds, rescue, and Fight Back

**Acceptance:** A14, A15

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_combat.py`
- Modify: `plugins/coc-keeper/scripts/coc_subsystem_executor.py`
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`
- Modify: `plugins/coc-keeper/scripts/coc_director_apply.py`
- Test: `tests/test_combat_state.py`
- Test: `tests/test_subsystem_executor.py`
- Test: `tests/test_live_turn_runner.py`

**Interfaces:**
- Consumes: Task 5 executor contracts.
- Produces: command kinds `combat_start`, `combat_attack`, `combat_defend`, `dying_tick`, `stabilize`, `combat_end`.

- [ ] **Step 1: Add a failing Fight Back damage regression**

```python
def test_successful_fight_back_damages_attacker():
    session = deterministic_fight_back_session(attacker_roll=70, defender_roll=20)
    turn = session.resolve_next()
    assert turn["outcome"] == "fight_back_hit"
    assert session.participants["attacker"]["hp_current"] < session.participants["attacker"]["hp_max"]
```

- [ ] **Step 2: Add failing canonical combat tests**

Start combat via `run_live_turn`, persist defense choice, apply damage, reload state, and assert Major Wound/prone/unconscious/dying conditions. Add stabilization and death-clock continuation.

- [ ] **Step 3: Fix Fight Back resolution**

When `defense_kind == "fight_back"` and defender wins, roll the defender weapon/unarmed damage against the original attacker, set outcome `fight_back_hit`, and record the damage roll ID.

- [ ] **Step 4: Implement combat command handlers**

Persist `CombatSession` at `save/combat.json`. Map stable actor IDs, defense choices, and engine events into subsystem results. Synchronize participant HP/conditions into investigator state atomically.

- [ ] **Step 5: Implement dying rescue commands**

`dying_tick` uses the existing healing/death-clock rules. `stabilize` distinguishes First Aid from Medicine and never reports death unless the state contains `dead`.

- [ ] **Step 6: Verify**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_combat_state.py tests/test_healing.py tests/test_subsystem_executor.py tests/test_live_turn_runner.py tests/test_live_match.py -q -p no:cacheprovider`

- [ ] **Step 7: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_combat.py plugins/coc-keeper/scripts/coc_subsystem_executor.py plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper/scripts/coc_director_apply.py tests/test_combat_state.py tests/test_subsystem_executor.py tests/test_live_turn_runner.py tests/test_live_match.py
git commit -m "fix(combat): wire wounds rescue and fight-back damage"
```

---

### Task 8: End-to-end ChaseSession execution

**Acceptance:** A16

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_chase.py`
- Modify: `plugins/coc-keeper/scripts/coc_subsystem_executor.py`
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`
- Test: `tests/test_chase_session.py`
- Test: `tests/test_subsystem_executor.py`
- Test: `tests/test_live_turn_runner.py`

**Interfaces:**
- Produces: command kinds `chase_start`, `chase_move`, `chase_hazard`, `chase_barrier`, `chase_conflict`, `chase_end`.

- [ ] **Step 1: Add a failing live chase journey**

The test must start a chase, cross a hazard, resolve a barrier, run one same-location conflict, reload `save/chase.json`, and end by escape or capture through `run_live_turn` calls.

- [ ] **Step 2: Add failing pending-choice tests**

When several legal chase actions exist, return a structured pending choice containing action IDs and player-safe labels; do not infer the choice from prose.

- [ ] **Step 3: Implement chase command handlers**

Load or create `ChaseSession`, call its existing movement/hazard/barrier/conflict APIs, persist after every command, and project structured events into the canonical result.

- [ ] **Step 4: Synchronize combat delegation and terminal state**

Same-location melee delegates to `CombatSession`; escape/capture/conclusion clears the pending chase choice and records a terminal chase event without ending the whole scenario unless policy says so.

- [ ] **Step 5: Verify**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_chase_session.py tests/test_subsystem_executor.py tests/test_live_turn_runner.py -q -p no:cacheprovider`

- [ ] **Step 6: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_chase.py plugins/coc-keeper/scripts/coc_subsystem_executor.py plugins/coc-keeper/scripts/coc_story_director.py tests/test_chase_session.py tests/test_subsystem_executor.py tests/test_live_turn_runner.py
git commit -m "feat(chase): execute persistent chases through live turns"
```

---

### Task 9: Persisted threat feedback and normalized scene functions

**Acceptance:** A17, A18, A19

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`
- Modify: `plugins/coc-keeper/scripts/coc_threat_state.py`
- Modify: `plugins/coc-keeper/scripts/coc_scenario_compile.py`
- Modify: `plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md`
- Test: `tests/test_story_director.py`
- Test: `tests/test_threat_engine.py`
- Test: `tests/test_scenario_compile.py`

**Interfaces:**
- Produces: `merge_threat_fronts(definitions, persisted) -> dict[str, Any]`.
- Produces: `normalize_scene_function(scene) -> dict[str, Any]`.

- [ ] **Step 1: Add a failing persisted-clock feedback test**

Save a 4/6 clock in `threat-state.json`, build context, and assert Director sees `current_segments == 4` and raises PRESSURE scoring.

- [ ] **Step 2: Add a failing relevant-front selection test**

Create two incomplete clocks with disjoint structured `scene_tags_any`/`faction_ids`. Assert the active scene selects the matching clock and records `selection_reason`.

- [ ] **Step 3: Implement threat merge and relevance selection**

Merge progress by `clock_id`; immutable authored fields remain authoritative. Rank by explicit scene/front/faction affinity, then severity, then stable ID. Never scan descriptions.

- [ ] **Step 4: Add scene-function normalization**

```python
def normalize_scene_function(scene):
    return {
        "scene_function": scene.get("scene_function") or scene.get("scene_type", "investigation"),
        "goals": list(scene.get("goals") or [scene.get("dramatic_question")] if scene.get("dramatic_question") else []),
        "required_reveals": list(scene.get("required_reveals") or []),
        "failure_modes": list(scene.get("failure_modes") or []),
        "exit_options": list(scene.get("exit_options") or []),
        "mode_affinity": list(scene.get("mode_affinity") or []),
    }
```

Fix operator grouping in the actual implementation so fallback goals are always a list.

- [ ] **Step 5: Validate and document schema**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_story_director.py tests/test_threat_engine.py tests/test_scenario_compile.py -q -p no:cacheprovider`

- [ ] **Step 6: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper/scripts/coc_threat_state.py plugins/coc-keeper/scripts/coc_scenario_compile.py plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md tests/test_story_director.py tests/test_threat_engine.py tests/test_scenario_compile.py
git commit -m "feat(director): merge live threats and normalize scene functions"
```

---

### Task 10: Live NPC psychology, knowledge, disclosure, and schedules

**Acceptance:** A20, A21

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_npc_state.py`
- Modify: `plugins/coc-keeper/scripts/coc_narrative_enrichment.py`
- Modify: `plugins/coc-keeper/scripts/coc_director_apply.py`
- Modify: `plugins/coc-keeper/scripts/coc_narration_contract.py`
- Test: `tests/test_npc_state.py`
- Test: `tests/test_narrative_enrichment.py`
- Test: `tests/test_narration_envelope.py`

**Interfaces:**
- Produces: `derive_npc_effects(intent_evidence, rule_results, npc_context) -> list[dict[str, Any]]`.
- Produces: `disclosure_decision(npc_state, fact) -> dict[str, Any]`.

- [ ] **Step 1: Add failing multi-turn social tests**

Assert ordinary live social turns generate and persist trust/suspicion effects. Reload the campaign and assert the next NPC stance changes.

- [ ] **Step 2: Add knowledge and willingness tests**

```python
def test_fact_is_withheld_without_knowledge_and_willingness():
    decision = disclosure_decision(npc_state(known=[]), fact(required_trust=2))
    assert decision == {"action": "withhold", "reason": "fact_not_known"}
```

Cover reveal, lie, deflect, and unavailable-by-schedule outcomes using structured fields.

- [ ] **Step 3: Extend NPC state schema compatibly**

Add `revealable_fact_ids`, `lie_options`, `availability`, and `schedule_state`. Defaults preserve old saves.

- [ ] **Step 4: Produce typed effects in live enrichment**

Use structured intent and rule outcomes to produce `npc_effects`; apply remains idempotent. Do not infer trust or hostility from agenda/player prose.

- [ ] **Step 5: Restrict narrator data**

Only selected player-visible reaction, stance, voice, and dialogue seed enter the envelope. Raw facts, lie plans, schedules, and secret agendas remain keeper-only.

- [ ] **Step 6: Verify**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_npc_state.py tests/test_narrative_enrichment.py tests/test_narration_envelope.py tests/test_director_apply.py -q -p no:cacheprovider`

- [ ] **Step 7: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_npc_state.py plugins/coc-keeper/scripts/coc_narrative_enrichment.py plugins/coc-keeper/scripts/coc_director_apply.py plugins/coc-keeper/scripts/coc_narration_contract.py tests/test_npc_state.py tests/test_narrative_enrichment.py tests/test_narration_envelope.py
git commit -m "feat(npc): drive live disclosure from persistent psychology"
```

---

### Task 11: Production crisis rendering, scenario strategies, horror profiles, and secret audit

**Acceptance:** A22, A23, A24, A25

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`
- Modify: `plugins/coc-keeper/scripts/coc_narration_style.py`
- Modify: `plugins/coc-keeper/scripts/coc_narration_contract.py`
- Create: `plugins/coc-keeper/scripts/coc_director_strategies.py`
- Create: `plugins/coc-keeper/scripts/coc_secret_audit.py`
- Modify: `plugins/coc-keeper/scripts/coc_live_turn_runner.py`
- Modify: `runtime/adapters/narrator/adapter.py`
- Modify: `runtime/adapters/narrator/run_narration.mjs`
- Test: `tests/test_narration_style.py`
- Test: `tests/test_narration_contract.py`
- Test: new `tests/test_director_strategies.py`
- Test: new `tests/test_secret_audit.py`
- Test: `tests/test_live_turn_runner.py`

**Interfaces:**
- Produces: `strategy_for(structure_type: str) -> DirectorStrategy`.
- Produces: `build_horror_profile(module_meta, scene, pacing) -> dict[str, float]`.
- Produces: `audit_secret_claims(forbidden_refs, asserted_fact_refs, semantic_evidence) -> dict[str, Any]`.

- [ ] **Step 1: Add failing production crisis-frame test**

Run a `SUBSYSTEM`/pressure scene through `run_live_turn` and assert `narration_envelope.render_frame.frame_type == "crisis_scene_render"` with all required slots.

- [ ] **Step 2: Add failing strategy tests**

Time-loop strategy persists loop number and player-retained memory IDs. Multi-faction strategy ranks pressure per faction. Unsupported special mechanics return an explicit capability finding.

- [ ] **Step 3: Add failing horror-profile tests**

Assert bounded numeric axes, scenario overrides, and absence of keeper-secret prose/IDs in player-visible fields.

- [ ] **Step 4: Add failing structured secret-audit tests**

The narrator response must include `asserted_fact_refs` and optional `semantic_audit` records. A forbidden fact ref or a semantic match with `decision="same_fact"` blocks evidence-grade output and triggers a safe fallback. Missing audit evidence fails closed for evidence eligibility but still permits recorded template fallback for ordinary play.

- [ ] **Step 5: Implement production mode/strategy/profile wiring**

Director emits explicit `investigation`, `social`, `pressure`, or `crisis` mode. Live runner invokes the crisis frame when mode is crisis and includes the horror profile in the minimum-privilege envelope.

- [ ] **Step 6: Implement secret audit without keyword matching**

```python
def audit_secret_claims(forbidden_refs, asserted_fact_refs, semantic_evidence):
    direct = sorted(set(forbidden_refs) & set(asserted_fact_refs))
    semantic = [e for e in semantic_evidence if e.get("decision") == "same_fact" and e.get("forbidden_ref") in forbidden_refs]
    return {"passed": not direct and not semantic, "direct_matches": direct, "semantic_matches": semantic}
```

- [ ] **Step 7: Verify**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_narration_style.py tests/test_narration_contract.py tests/test_director_strategies.py tests/test_secret_audit.py tests/test_live_turn_runner.py tests/test_narrator_adapter.py -q -p no:cacheprovider`

- [ ] **Step 8: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper/scripts/coc_narration_style.py plugins/coc-keeper/scripts/coc_narration_contract.py plugins/coc-keeper/scripts/coc_director_strategies.py plugins/coc-keeper/scripts/coc_secret_audit.py plugins/coc-keeper/scripts/coc_live_turn_runner.py runtime/adapters/narrator/adapter.py runtime/adapters/narrator/run_narration.mjs tests/test_narration_style.py tests/test_narration_contract.py tests/test_director_strategies.py tests/test_secret_audit.py tests/test_live_turn_runner.py
git commit -m "feat(narration): add crisis strategies profiles and secret audit"
```

---

### Task 12: Runtime path safety and typed PublicState gateway

**Acceptance:** A26, A28

**Files:**
- Create: `runtime/engine/paths.py`
- Create: `runtime/engine/state_gateway.py`
- Modify: `runtime/engine/session.py`
- Modify: `runtime/engine/public_state.py`
- Modify: `runtime/sdk/api.py`
- Test: new `tests/test_runtime_paths.py`
- Test: `tests/test_runtime_public_state.py`
- Test: `tests/test_runtime_sdk_debug.py`

**Interfaces:**
- Produces: `validate_id(value: str, field: str) -> str`.
- Produces: `contained_path(root: Path, candidate: Path) -> Path`.
- Produces: `RuntimeStateGateway` typed load methods and warning events.

- [ ] **Step 1: Add traversal and symlink escape tests**

Reject `../x`, absolute IDs, path separators, empty IDs, and a symlink inside workspace pointing outside. Allow stable ASCII IDs with `._-`.

- [ ] **Step 2: Add PublicState corruption tests**

Corrupt `world-state.json`; assert a backup is created, a structured warning/error is returned, and HP/SAN/scene are not silently fabricated as healthy defaults.

- [ ] **Step 3: Implement path helpers**

```python
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

def validate_id(value, field):
    if not ID_RE.fullmatch(value):
        raise ValueError(f"invalid {field}")
    return value
```

`contained_path` resolves both paths and uses `relative_to` to enforce containment.

- [ ] **Step 4: Implement the state gateway**

Load campaign/world/pacing/investigator state through `coc_state` typed loaders. Translate warnings into runtime event payloads while keeping keeper-only backup paths out of player-visible PublicState.

- [ ] **Step 5: Wire session/PublicState/SDK**

Validate before storing a session. Arbitrary `character_path` must resolve inside workspace `.coc/` unless an explicit future capability grants another root.

- [ ] **Step 6: Verify**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_runtime_paths.py tests/test_runtime_public_state.py tests/test_runtime_sdk_debug.py tests/test_state_migration.py -q -p no:cacheprovider`

- [ ] **Step 7: Commit**

```bash
git add runtime/engine/paths.py runtime/engine/state_gateway.py runtime/engine/session.py runtime/engine/public_state.py runtime/sdk/api.py tests/test_runtime_paths.py tests/test_runtime_public_state.py tests/test_runtime_sdk_debug.py
git commit -m "fix(runtime): enforce paths and use typed state gateway"
```

---

### Task 13: Session lifecycle and real production migration

**Acceptance:** A27, A29

**Files:**
- Modify: `runtime/engine/session.py`
- Modify: `runtime/sdk/api.py`
- Modify: `plugins/coc-keeper/scripts/coc_state.py`
- Test: new `tests/test_runtime_session_lifecycle.py`
- Test: `tests/test_state_migration.py`

**Interfaces:**
- Produces: `SessionRegistry` with `create/get/touch/close/expire/snapshot/restore`.
- Produces: production state schema version 2 and registered v1→v2 migrator.

- [ ] **Step 1: Add concurrency, TTL, and recovery tests**

Use a fake monotonic clock. Concurrent creates/gets must not lose sessions. Expired sessions become unknown. Snapshot/restore recreates metadata but never revives closed sessions.

- [ ] **Step 2: Add a real migration round-trip test**

Migrate a v1 world state to v2 with normalized `terminal_state` and `pending_subsystem_choice` fields; assert atomic rewrite and idempotent reload. Keep forward-version rejection.

- [ ] **Step 3: Implement `SessionRegistry`**

Use `threading.RLock`, update `last_access_monotonic`, and make TTL configurable. Persist only recoverable metadata under workspace runtime state; do not persist secrets or open subprocess handles.

- [ ] **Step 4: Register the production migration**

Set the chosen state kind current version to 2 and register a pure v1→v2 function in `MIGRATIONS`. Update all new-state writers to emit v2.

- [ ] **Step 5: Convert expected SDK failures**

Keep Python exceptions for programmer misuse at low-level APIs; public send/state operations expose a typed runtime error event or documented SDK exception with stable kind.

- [ ] **Step 6: Verify**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_runtime_session_lifecycle.py tests/test_runtime_sdk_debug.py tests/test_state_migration.py tests/test_state.py -q -p no:cacheprovider`

- [ ] **Step 7: Commit**

```bash
git add runtime/engine/session.py runtime/sdk/api.py plugins/coc-keeper/scripts/coc_state.py tests/test_runtime_session_lifecycle.py tests/test_state_migration.py tests/test_state.py
git commit -m "feat(runtime): add recoverable sessions and production migration"
```

---

### Task 14: Runtime composition, persistent adapters, and telemetry

**Acceptance:** A30, A31, A32

**Files:**
- Modify: `runtime/engine/config.py`
- Modify: `runtime/engine/session.py`
- Create: `runtime/adapters/worker_pool.py`
- Modify: `runtime/adapters/pi/adapter.py`
- Modify: `runtime/adapters/pi/run_turn.mjs`
- Modify: `runtime/adapters/player/adapter.py`
- Modify: `runtime/adapters/player/run_player_turn.mjs`
- Modify: `runtime/adapters/narrator/adapter.py`
- Modify: `runtime/adapters/narrator/run_narration.mjs`
- Modify: `runtime/protocol/PROTOCOL.md`
- Test: `tests/test_runtime_config.py`
- Test: new `tests/test_runtime_worker_pool.py`
- Test: `tests/test_runtime_pi_adapter_contract.py`
- Test: `tests/test_runtime_player_adapter_contract.py`
- Test: `tests/test_narrator_adapter.py`

**Interfaces:**
- Produces: config `{planner: {kind}, rules: {kind}, narrator: {kind}, player: {kind}}`.
- Produces: `JsonlWorkerPool.request(worker_key, payload, timeout_s) -> dict`.
- Produces: per-turn telemetry `{intent_ms, director_ms, rules_ms, persistence_ms, player_llm_ms, narrator_llm_ms, total_ms, input_tokens, output_tokens, fallback, runner}`.

- [ ] **Step 1: Add config migration tests**

`brain=debug` maps to deterministic planner/rules plus template narrator. `brain=pi` maps to deterministic planner/rules plus Pi narrator and records a deprecation warning; it must not call an LLM merely to proxy `debug_send_turn`.

- [ ] **Step 2: Add worker reuse tests**

Send two requests through a fake JSONL worker and assert the same process PID handles both. Assert timeout/crash removes the worker and the next request starts one replacement.

- [ ] **Step 3: Add telemetry contract tests**

Assert all phase fields are nonnegative, `total_ms` bounds their measured span, unavailable token counts are `None`, and fallback/runner fields are always present.

- [ ] **Step 4: Implement composable config**

Load the new pipeline shape first; migrate legacy `brain` in memory with warnings. Session binding freezes the resolved pipeline at create time.

- [ ] **Step 5: Implement persistent JSONL worker transport**

Node scripts accept a server mode that reads one JSON object per line and writes one response per line while retaining one agent session. Python pool owns process lifecycle, locking, timeout, and replacement. Keep one-shot mode for compatibility tests.

- [ ] **Step 6: Remove Pi proxy semantics**

The Pi narrator receives only a safe narration envelope after deterministic planner/rules execution. Delete or deprecate the LLM→`call_debug.py` proxy path without breaking legacy config migration.

- [ ] **Step 7: Instrument the canonical pipeline**

Use `time.perf_counter()` around phases. Accept optional usage metadata from adapters. Persist telemetry beside turn receipts without exposing secrets to players.

- [ ] **Step 8: Verify**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_runtime_config.py tests/test_runtime_worker_pool.py tests/test_runtime_pi_adapter_contract.py tests/test_runtime_player_adapter_contract.py tests/test_narrator_adapter.py tests/test_runtime_sdk_debug.py -q -p no:cacheprovider
```

Run `npm ci` in each adapter directory and execute its real contract smoke when credentials are not required.

- [ ] **Step 9: Commit**

```bash
git add runtime/engine/config.py runtime/engine/session.py runtime/adapters/worker_pool.py runtime/adapters/pi runtime/adapters/player runtime/adapters/narrator runtime/protocol/PROTOCOL.md tests/test_runtime_config.py tests/test_runtime_worker_pool.py tests/test_runtime_pi_adapter_contract.py tests/test_runtime_player_adapter_contract.py tests/test_narrator_adapter.py
git commit -m "feat(runtime): compose brains reuse workers and record telemetry"
```

---

### Task 15: Integrated product smoke, diagnosis ledger, and terminal validation

**Acceptance:** A33, A34 and all preceding acceptance items

**Files:**
- Create: `docs/status/DIAGNOSIS-LEDGER.md`
- Modify: `docs/status/CURRENT.md`
- Modify: `CHANGELOG.md`
- Test: new `tests/test_product_smoke.py`
- Test: all `tests/`

**Interfaces:**
- Consumes: all prior task contracts.
- Produces: terminal diagnosis mapping and final validation evidence.

- [ ] **Step 1: Add the product smoke**

The smoke must:

1. install a built-in starter with a pregen;
2. create a session;
3. play investigation, social, SAN, push, combat, and chase turns;
4. save and close;
5. restore in a fresh session registry;
6. continue one turn;
7. end through structured terminal evidence; and
8. generate an evidence receipt and report.

Use deterministic fake semantic/model adapters; mark the artifact non-gameplay evidence.

- [ ] **Step 2: Build the diagnosis ledger**

Use this exact schema:

```markdown
| Original claim | Current classification | Root cause | Fix/evidence | Acceptance ID |
|---|---|---|---|---|
```

Include every item from both user-provided reviews. Explain stale documents, standalone-vs-live confusion, test gaps, defect-enshrining tests, and misleading metadata.

- [ ] **Step 3: Run static and focused gates**

```bash
git diff --check
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py -q -p no:cacheprovider
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_product_smoke.py tests/test_live_turn_runner.py tests/test_live_match.py -q -p no:cacheprovider
```

- [ ] **Step 4: Run the full Python suite**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/ -q -p no:cacheprovider`

Expected: zero failures. If the shell execution window is shorter than the suite, split by sorted test files and prove the union covers every test file.

- [ ] **Step 5: Run Node and package gates**

Run `npm ci` for `runtime/adapters/pi`, `player`, and `narrator`; run all adapter contract tests. Verify lockfiles are present and deterministic.

- [ ] **Step 6: Run adversarial checks**

Verify path traversal/symlink rejection, corrupt-state backup, evidence spoof rejection, secret-audit failure, worker crash/restart, migration forward-version rejection, and non-last terminal scenes.

- [ ] **Step 7: Attempt the evidence-grade live journey**

When a real external model runner and credentials are available, run 10–20 turns including failure, SAN, NPC interaction, save/reload, and deviation. Read `battle-report.md` end to end before accepting it. If credentials are unavailable, record only this item as `Blocked`; do not substitute a scripted artifact.

- [ ] **Step 8: Confirm workspace and acceptance terminality**

`git status --short`, `git diff --check`, and the A01–A34 table must show no unexplained changes, no Partial/Missing/Untested item, and no silent deferral.

- [ ] **Step 9: Commit final shared documentation**

```bash
git add docs/status/DIAGNOSIS-LEDGER.md docs/status/CURRENT.md CHANGELOG.md tests/test_product_smoke.py
git commit -m "docs(status): close full hardening acceptance ledger"
```

## Final Review Gates

After Task 15, dispatch independent Codex reviewers for:

1. spec compliance and A01–A34 traceability;
2. rules correctness and live-path wiring;
3. runtime security/state/migration boundaries; and
4. narration secrecy/evidence integrity.

Each reviewer must produce a read-only handoff. Actionable findings return to a revision subagent; the lead does not patch worker code directly.
