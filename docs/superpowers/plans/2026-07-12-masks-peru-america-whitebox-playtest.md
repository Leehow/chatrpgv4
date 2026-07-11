# Masks Peru + America White-Box Playtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a resumable canonical interactive-play path, prepare evidence-gated Peru/America chapter packages, and complete spoiler-aware plus spoiler-blind GLM-5.2 Keeper runs with white-box rule, orchestration, and prose evaluations.

**Architecture:** Extend the existing public session turn with validated structured player intent and a caller-recorded deterministic turn seed, then wrap it in a long-lived JSONL interactive driver that checkpoints every accepted turn. Keep copyrighted chapter compilation under ignored `.coc/` staging and carry only stripped source evidence through the module registry. Run a diagnostic spoiler lane first, freeze the repaired revision, then run a fresh context-free blind player lane and compare their route graphs.

**Tech Stack:** Python 3.13, pytest, JSON/JSONL, `runtime.sdk`, existing COC Keeper scripts, Node/Pi Agent with `zhipu-coding/glm-5.2`, pymupdf4llm through `pdf_cache.extract_markdown()`, Codex subagents for player/evaluator lanes.

## Global Constraints

- Canonical plugin code lives only under `plugins/coc-keeper/`; do not create a host-specific duplicate tree.
- Runtime turns must enter through `runtime.sdk.api.send`; rule, Director, terminal, SAN, combat, chase, and epistemic helpers must not manufacture play coverage.
- Meaning-bearing routing must use explicit structured fields or a semantic evaluator; never scan free prose with hardcoded keywords.
- `zhipu-coding/glm-5.2` is the sole KP prose model. Do not silently replace it with a stronger model.
- Run A is `diagnostic_spoiler_run`; Run B is a fresh spoiler-blind player lane with no parent conversation or Run A context.
- Each primary run has its own 500-turn hard ceiling. Checkpoint every accepted turn and review every ten turns plus every scene/chapter boundary.
- Only a recomputed eligible evidence receipt may produce `battle-report.md`; scripted, spoiler-diagnostic, missing, invalid, or ineligible evidence uses an explicitly labelled diagnostic/verification artifact.
- Raw PDF prose, handout text, Keeper-secret prose, and the source PDF remain local and untracked. Module-library evidence segments must not contain `text`.
- Source PDF SHA-256 is exactly `806966db20202a020af6213695dccc0b547fc998a73dd2f1344567e2579a1942`.
- Printed page mapping is authoritative only through `index/page-map.json`; no fixed page offset is allowed.
- Do not push, deploy, delete user data, or mutate the user's real campaigns/investigators during execution.

---

### Task 1: Canonical structured player turns and deterministic replay seeds

**Files:**
- Modify: `runtime/sdk/api.py`
- Modify: `runtime/engine/session.py`
- Modify: `runtime/protocol/PROTOCOL.md`
- Test: `tests/test_runtime_sdk_debug.py`
- Test: `tests/test_runtime_session_lifecycle.py`

**Interfaces:**
- Produces: `send(session_id, player_input, *, player_intent=None, rng_seed=None, subsystem_request=None, pending_choice_response=None) -> list[Event]`.
- `player_intent` is a caller-owned structured statement of the player's intended action, not a semantic interpretation inferred from prose.
- `rng_seed` is an exact non-boolean `int | str` used for this turn only and recorded in the live runtime receipt; omitted values preserve current production entropy.

- [ ] **Step 1: Write failing public-contract tests**

Add tests that call the real SDK and assert a structured investigate/social intent reaches `live-turn-runtime.jsonl` with `source == "caller_intent_class"`, that the same seed and pre-turn snapshot produce identical roll payloads, and that malformed intents or boolean/collection seeds fail before campaign mutation.

```python
intent = {
    "primary_intent": "investigate",
    "secondary_intents": [],
    "target_entities": ["scene"],
    "risk_posture": "cautious",
    "explicit_roll_request": False,
    "player_hypothesis": None,
    "action_atoms": [{"topic": "room", "verb": "search"}],
    "npc_interactions": [],
}
events = sdk.send(sid, "我仔细搜查房间。", player_intent=intent, rng_seed="run-a:0001")
assert events
```

- [ ] **Step 2: Run the new tests and confirm RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_runtime_sdk_debug.py \
  tests/test_runtime_session_lifecycle.py \
  -q -p no:cacheprovider
```

Expected: failures because `send()` does not accept `player_intent` or `rng_seed`.

- [ ] **Step 3: Implement strict caller-intent validation and forwarding**

Add a private normalizer in `session.py` that requires exactly the public intent fields, validates `primary_intent` against the router enum, requires string-list targets/secondary intents, JSON-only action atoms/NPC interactions, and rejects unknown fields. Forward:

```python
kwargs = {}
if player_intent is not None:
    normalized = _validate_player_intent(player_intent)
    kwargs["intent_class"] = normalized["primary_intent"]
    kwargs["player_intent_rich"] = normalized
if rng_seed is not None:
    kwargs["rng_seed"] = _validate_rng_seed(rng_seed)
```

Do not derive `player_intent` from `player_input`. Persist the exact intent class, intent source, and seed identifier in the existing structured runtime log without writing the seed into player-visible narration.

- [ ] **Step 4: Document the one-turn input contract**

Update `PROTOCOL.md` with the JSON-equivalent player turn shape:

```json
{
  "player_input": "我仔细搜查房间。",
  "player_intent": {
    "primary_intent": "investigate",
    "secondary_intents": [],
    "target_entities": ["scene"],
    "risk_posture": "cautious",
    "explicit_roll_request": false,
    "player_hypothesis": null,
    "action_atoms": [{"topic": "room", "verb": "search"}],
    "npc_interactions": []
  },
  "rng_seed": "run-a:0001"
}
```

- [ ] **Step 5: Run focused and full runtime tests**

Run the Step 2 command plus:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_live_turn_runner.py tests/test_intent_router.py \
  -q -p no:cacheprovider
```

Expected: zero failures.

- [ ] **Step 6: Commit Task 1**

```bash
git add runtime/sdk/api.py runtime/engine/session.py runtime/protocol/PROTOCOL.md \
  tests/test_runtime_sdk_debug.py tests/test_runtime_session_lifecycle.py
git commit -m "feat(runtime): accept reproducible structured player turns"
```

---

### Task 2: Containment-safe per-turn journal and resumable checkpoints

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_playtest_checkpoint.py`
- Test: `tests/test_playtest_checkpoint.py`
- Test: `tests/test_playtest_checkpoint_runtime.py`

**Interfaces:**
- Produces: `CheckpointStore(run_dir, workspace, campaign_id, investigator_id)`.
- Produces: `append_turn(action, events, pre_state, post_state, provenance) -> Path`.
- Produces: `write_checkpoint(session_id, turn_number, reason) -> Path`.
- Produces: `restore_checkpoint(checkpoint_dir, target_workspace) -> dict`.
- Each manifest contains schema version, run ID, turn number, Git HEAD, source/scenario hashes, state-file manifest, session snapshot hash, action-ledger hash chain, model identity, and invalidation state.

- [ ] **Step 1: Write RED tests for atomic journals and hostile paths**

Cover one-turn durability, truncated last JSONL recovery, checksum mismatch rejection, source/target symlink rejection, `../` containment, checkpoint restore into a fresh workspace, and outside sentinels remaining unchanged.  The fixture must use the real public runtime layout under `.coc/`, not a synthetic top-level `campaigns/` tree.

```python
store = checkpoint.CheckpointStore(run_dir, workspace, "masks-run-a", "inv-a")
turn_path = store.append_turn(action, events, pre_state, post_state, provenance)
cp = store.write_checkpoint("sess_123", 1, "turn_complete")
restored = store.restore_checkpoint(cp, fresh_workspace)
assert restored["turn_number"] == 1
assert restored["action_chain_sha256"] == store.action_chain_sha256
```

- [ ] **Step 2: Confirm hostile-path tests fail**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_playtest_checkpoint.py -q -p no:cacheprovider
```

Expected: module missing.

- [ ] **Step 3: Implement the checkpoint store**

Use `Path.resolve()`, lexical containment, component symlink rejection, random `O_CREAT|O_EXCL|O_NOFOLLOW` temporary files, directory-FD-relative replace/unlink, and SHA-256 manifests.  Root all workspace paths at the canonical public layout.  Copy only:

- `.coc/campaigns/<campaign>/campaign.json`, optional `party.json`, and the complete contained `save/`, `scenario/`, `index/`, `memory/`, `logs/`, and optional local `source/` trees;
- the exact scenario-bound investigator files `creation.json`, `character.json`, `history.jsonl`, `development.jsonl`, and `inventory-history.jsonl`;
- sanitized `.coc/runtime/sessions.json`; and
- the run action journal.

Restore into a fresh workspace generation, never destructively reconcile the active one.  The target may contain only a caller-supplied compatible `.coc/runtime.json` and prepared selected indexes; any pre-existing managed campaign, selected investigator, sessions, or restored journal path fails before the first restore write.  Immutable source/scenario/index files must match the checkpoint manifest.  Never copy `.coc/runtime.json`, credentials, Node worker state, absolute-path configuration, another campaign, or another investigator.

Require the last accepted turn provenance to attest `recording_mode=sync` and
`recording_flush=manual`; reject checkpoint publication for fast/background
recording because detached log writes can make a cross-file snapshot
inconsistent.  Parse `.coc/runtime/sessions.json`, retain exactly the requested
session bound to this campaign/investigator/character path, and remove unrelated
sessions and tombstones from the checkpoint copy.  The manifest records every
managed root and every absent optional file/root needed for exact-mirror restore.

Each action ledger row must chain:

```python
row["previous_sha256"] = previous_sha
row["row_sha256"] = sha256(canonical_json({k: v for k, v in row.items() if k != "row_sha256"}))
```

- [ ] **Step 4: Add resume compatibility checks**

Reject resume when source PDF hash, scenario file hashes, player mode, run ID, or checkpoint schema differs. Allow a different Git HEAD only when an `invalidated_segment` record explicitly names the old/new commits and replay start checkpoint.

Add a real-runtime integration test: create/send through `runtime.sdk.api` with the canonical debug adapter forced to synchronous/manual recording, snapshot after an accepted turn with pending/public state, mutate the active workspace with a later turn and an extra managed file, restore into a fresh generation containing only a compatible runtime config/prepared selected indexes, reload the filtered sanitized session snapshot in a fresh registry, and prove PublicState plus the next seeded SDK turn continue from the checkpoint while the later file is absent and the old generation remains untouched.  Also prove a fast/background receipt, an unrelated session, and any pre-existing managed target path fail closed.

- [ ] **Step 5: Run checkpoint, path, and state tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_playtest_checkpoint.py tests/test_playtest_checkpoint_runtime.py \
  tests/test_runtime_paths.py \
  tests/test_state_migration.py -q -p no:cacheprovider
```

- [ ] **Step 6: Commit Task 2**

```bash
git add plugins/coc-keeper/scripts/coc_playtest_checkpoint.py \
  tests/test_playtest_checkpoint.py
git commit -m "feat(playtest): add durable turn checkpoints"
```

---

### Task 3: Long-lived interactive white-box play driver

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_interactive_playtest.py`
- Modify: `plugins/coc-keeper/references/trusted-playtest-runners.json`
- Modify: `runtime/engine/session.py`
- Modify: `runtime/engine/telemetry.py`
- Modify: `runtime/engine/live_turn_mapper.py`
- Modify: `runtime/engine/events.py`
- Modify: `runtime/engine/public_state.py`
- Modify: `runtime/sdk/api.py`
- Test: `tests/test_interactive_playtest.py`
- Test: `tests/test_plugin_metadata.py`
- Test: `tests/test_runtime_sdk_debug.py`
- Test: `tests/test_runtime_session_lifecycle.py`

**Interfaces:**
- CLI `start --workspace --campaign --investigator --run-dir --run-kind --rng-seed --max-turns` enters JSONL stdin/stdout mode.
- CLI `resume --run-dir --checkpoint` restores a valid checkpoint and records a model-session boundary.
- Input kinds: `turn`, `pending_choice`, `checkpoint`, `stop`.
- Output kinds: `ready`, `turn_result`, `checkpoint_written`, `terminal`, `error`.

- [ ] **Step 1: Write end-to-end RED tests with a fake narrator worker**

Start the CLI as a subprocess, send two JSON actions, assert both reach `runtime.sdk.api.send`, and verify the second output includes only PublicState and player-visible Events. Kill the process after turn two, resume from the latest checkpoint, submit turn three, and assert one continuous action hash chain with an explicit model-session boundary.

```json
{"kind":"turn","player_input":"我检查门锁。","player_intent":{"primary_intent":"investigate","secondary_intents":[],"target_entities":["door"],"risk_posture":"cautious","explicit_roll_request":false,"player_hypothesis":null,"action_atoms":[{"topic":"door","verb":"examine"}],"npc_interactions":[]}}
```

- [ ] **Step 2: Confirm RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_interactive_playtest.py -q -p no:cacheprovider
```

- [ ] **Step 3: Implement the long-lived driver**

The driver must:

1. validate `run_kind` as `diagnostic_spoiler_run | blind_actual_play`;
2. require max turns in `1..500`;
3. create/restore a public runtime session;
4. derive exact seeds such as `masks-run-a-20260712:000001` from the run's
   recorded base seed and accepted turn number;
5. call only `runtime.sdk.api.send` for gameplay;
6. request the public checkpoint-durability turn mode (synchronous recording,
   manual flush), then write the action and checkpoint before emitting the
   player-safe result;
7. emit terminal only from structured `session_ending` or validated graph/chapter terminal evidence;
8. stop without another model call at the hard ceiling; and
9. close the runtime session/worker pool on every normal or exceptional exit.

On resume, restore into a new workspace generation.  In a fresh registry,
require restoration of the exact expected session ID and verify PublicState
against the checkpoint before atomically replacing the run metadata's
`active_workspace_generation`.  Keep the previous generation unchanged for
diagnosis/retry; a failed validation must not move the pointer.

Do not place Keeper events, raw NarrationEnvelope, scenario paths, or evaluator output in stdout.

The public SDK must expose player-safe structured terminal evidence rather than
dropping `session_ending`, and public telemetry/session receipts must preserve
the narrator adapter's observed identity, response mode, and deterministic
fallback flag.  Do not expose raw turns or Keeper-only envelopes to achieve
either requirement.  Session snapshot/restore needed by the driver must be a
public sanitized workspace operation rather than private registry access.

- [ ] **Step 4: Prove GLM identity attestation is recorded**

Persist narrator `model_identity.provider == "zhipu-coding"` and
`model_identity.id == "glm-5.2"` from the adapter response. Treat missing,
different, or fallback model identity as a canary/run blocker; never rewrite it.

- [ ] **Step 5: Register and test the trusted driver hash**

Add the driver path and SHA-256 to `trusted-playtest-runners.json`. Metadata tests must fail on source changes until the digest is refreshed in the same commit.

- [ ] **Step 6: Run driver and plugin gates**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_interactive_playtest.py tests/test_runtime_sdk_debug.py \
  tests/test_plugin_metadata.py -q -p no:cacheprovider
node --check runtime/adapters/narrator/run_narration.mjs
npm test --prefix runtime/adapters/narrator
```

- [ ] **Step 7: Commit Task 3**

```bash
git add plugins/coc-keeper/scripts/coc_interactive_playtest.py \
  plugins/coc-keeper/references/trusted-playtest-runners.json \
  tests/test_interactive_playtest.py tests/test_plugin_metadata.py
git commit -m "feat(playtest): add interactive white-box driver"
```

---

### Task 4: Interactive evidence, spoiler disclosure, and route comparison

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_playtest_evidence.py`
- Modify: `plugins/coc-keeper/scripts/coc_playtest_report.py`
- Modify: `plugins/coc-keeper/scripts/coc_playtest_audit.py`
- Create: `plugins/coc-keeper/scripts/coc_playtest_route_compare.py`
- Test: `tests/test_playtest_evidence.py`
- Test: `tests/test_playtest_report.py`
- Test: `tests/test_playtest_audit.py`
- Create: `tests/test_playtest_route_compare.py`

**Interfaces:**
- Interactive evidence binds the trusted driver digest, action-ledger chain, transcript/view hashes, checkpoint chain, and narrator invocation/model identity.
- Run A always renders `diagnostic-play-report.md` with a visible spoiler-aware heading, never a normal battle-report filename.
- Run B may render `battle-report.md` only when recomputed eligibility is true.
- Route comparator produces `artifacts/route-comparison.json` and `.md`.

- [ ] **Step 1: Write evidence and naming attack tests**

Test valid interactive Run B eligibility, tampered player action, missing checkpoint, broken hash chain, GLM model mismatch, self-declared Run B without trusted driver, Run A spoiler disclosure, stale sibling cleanup, and symlink/containment attacks.

- [ ] **Step 2: Write route comparison RED tests**

Given two structured route ledgers, require every Run-A-only scene/edge to be classified exactly once as `optional`, `insufficiently_signposted`, `mechanically_blocked`, or `reasonably_undiscovered`, with evidence refs and non-empty evaluator reasons.

- [ ] **Step 3: Implement evidence and report integration**

Recompute eligibility from files, never from `playtest.json` claims. Include `run_kind` in the signed receipt. Use the existing containment-safe atomic artifact writer and remove only known stale sibling artifacts inside the verified artifacts directory.

- [ ] **Step 4: Implement route comparison**

Consume structured scene/edge/choice ledgers plus an artifact-mediated semantic result. Bind result to exact request SHA, require evaluator ID and reasons, and reject prose keyword classification.

- [ ] **Step 5: Run evidence/report/audit tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_playtest_evidence.py tests/test_playtest_report.py \
  tests/test_playtest_audit.py tests/test_playtest_route_compare.py \
  tests/test_live_match.py -q -p no:cacheprovider
```

- [ ] **Step 6: Commit Task 4**

```bash
git add plugins/coc-keeper/scripts/coc_playtest_evidence.py \
  plugins/coc-keeper/scripts/coc_playtest_report.py \
  plugins/coc-keeper/scripts/coc_playtest_audit.py \
  plugins/coc-keeper/scripts/coc_playtest_route_compare.py \
  tests/test_playtest_evidence.py tests/test_playtest_report.py \
  tests/test_playtest_audit.py tests/test_playtest_route_compare.py
git commit -m "feat(playtest): attest interactive and spoiler-blind routes"
```

---

### Task 5: Carry stripped source evidence through module registration

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_module_registry.py`
- Test: `tests/test_module_registry.py`
- Test: `tests/test_source_evidence_bridge.py`

**Interfaces:**
- Registry entries may contain `index/page-map.json`, `index/parse-manifest.json`, and `index/evidence-segments.jsonl`.
- Registration calls `coc_pdf_source.strip_local_evidence_text()` before writing.
- Installation copies the stripped bundle and rebinds `source_root` to the campaign; it never copies raw text or an absolute staging path into semantic/Narrator artifacts.

- [ ] **Step 1: Write RED register/install tests**

Create a synthetic package with one evidence segment containing `text`, register it, assert the registry copy preserves hashes/locators but removes `text`, install it, and assert critical source validation still succeeds against the explicit local source root. Add traversal/symlink and partial-bundle rejection tests.

- [ ] **Step 2: Confirm RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_module_registry.py tests/test_source_evidence_bridge.py \
  -q -p no:cacheprovider
```

- [ ] **Step 3: Implement safe evidence carryover**

Treat the three index files as one atomic optional bundle: absent is legacy-compatible; all three present is copied after validation/stripping; a partial set is rejected. Use containment-safe writes and preserve no local `source_root` member in the registry.

- [ ] **Step 4: Run module/source/epistemic tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_module_registry.py tests/test_source_evidence_bridge.py \
  tests/test_epistemic_compiler_lifecycle_v2.py \
  tests/test_epistemic_boundary_hardening.py -q -p no:cacheprovider
```

- [ ] **Step 5: Commit Task 5**

```bash
git add plugins/coc-keeper/scripts/coc_module_registry.py \
  tests/test_module_registry.py tests/test_source_evidence_bridge.py
git commit -m "feat(scenario): preserve safe source evidence in modules"
```

---

### Task 6: Atomic sibling-chapter switching

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_chapter_switch.py`
- Test: `tests/test_chapter_switch.py`

**Interfaces:**
- Produces: `switch_chapter(workspace, campaign_id, target_module_id, terminal_evidence) -> dict`.
- Requires source and target identities to share `parent_module_id`.
- Preserves investigator state, inventory, rolls, memories, NPC history, threats, belief/questions, language, and chapter history while replacing only scenario/index chapter files and setting the validated entry scene.

- [ ] **Step 1: Write RED transition tests**

Use synthetic Peru/America/England siblings. Assert no switch without structured source terminal evidence, mismatched parent rejection, successful state preservation, entry-scene activation, source-bundle replacement, ID collision rejection, rollback on a failed write, and symlink containment.

- [ ] **Step 2: Confirm RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_chapter_switch.py -q -p no:cacheprovider
```

- [ ] **Step 3: Implement prepare/validate/commit switching**

Stage the target scenario/index in a sibling temporary directory, validate the complete target package, calculate a preservation manifest, then atomically exchange the scenario/index directories. Append `logs/chapter-history.jsonl` only after success. On any exception, retain the original chapter byte-for-byte.

- [ ] **Step 4: Run transition and runtime tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_chapter_switch.py tests/test_module_registry.py \
  tests/test_runtime_session_lifecycle.py tests/test_epistemic_runtime_integration.py \
  -q -p no:cacheprovider
```

- [ ] **Step 5: Commit Task 6**

```bash
git add plugins/coc-keeper/scripts/coc_chapter_switch.py tests/test_chapter_switch.py
git commit -m "feat(scenario): switch sibling chapters atomically"
```

---

### Task 7: Repair and evidence-gate the Peru package

**Files (ignored local artifacts):**
- Modify: `.coc/module-library/masks-of-nyarlathotep-ch-peru/scenario/clue-graph.json`
- Create: `.coc/module-library/masks-of-nyarlathotep-ch-peru/index/page-map.json`
- Create: `.coc/module-library/masks-of-nyarlathotep-ch-peru/index/parse-manifest.json`
- Create: `.coc/module-library/masks-of-nyarlathotep-ch-peru/index/evidence-segments.jsonl`
- Create: `.coc/playtests/masks-prep-20260712/peru-validation.json`

**Interfaces:**
- Peru validator returns zero errors.
- Seven social clues bind to the exact existing NPC IDs listed below.
- Every critical source ref resolves through accepted page/range/segment evidence with confidence `>= 0.80`.

- [ ] **Step 1: Record the seven current A21 failures**

Run structured validation and save its exact JSON findings before editing:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 \
  plugins/coc-keeper/scripts/coc_scenario_compile.py \
  .coc/module-library/masks-of-nyarlathotep-ch-peru/scenario \
  --validate --structured
```

- [ ] **Step 2: Add the source NPC bindings**

Apply exactly:

```json
{
  "clue-larkin-recruitment-pitch": ["npc-augustus-larkin"],
  "clue-elias-warns-expedition": ["npc-jackson-elias"],
  "clue-sanchez-corroborates-doubt": ["npc-prof-sanchez"],
  "clue-local-kharisiri-fear": ["npc-nayra"],
  "clue-nayra-directions": ["npc-nayra"],
  "clue-hotel-gossip-larkin": ["npc-petronila-cupitina"],
  "clue-elias-parting-bond": ["npc-jackson-elias"]
}
```

Confirm every ID exists in `npc-agendas.json`; do not infer a substitute by fuzzy name matching.

- [ ] **Step 3: Build the Peru source bundle**

Initialize the exact PDF identity/hash, populate a page map for the Peru range from verified labels/bookmarks, extract only mapped zero-based indices via `pdf_cache.extract_markdown(..., use_ocr=False)`, and write accepted parse ranges plus evidence segments. Keep local segment `text` only in the campaign/staging copy; strip it before registry storage.

- [ ] **Step 4: Validate all critical source refs**

For every critical clue source ref, call `critical_source_allowed()` and save locator, confidence, review state, anchor result, and findings in `peru-validation.json`. Any HOLD blocks Run A setup.

- [ ] **Step 5: Re-register and reinstall Peru into a disposable sandbox**

Register the repaired package, install it into `.coc/playtests/masks-prep-20260712/peru-install-smoke`, and verify the installed scenario plus stripped index bundle validate identically.

- [ ] **Step 6: Run local and repository gates**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_scenario_compile.py tests/test_npc_state.py \
  tests/test_story_director.py tests/test_source_evidence_bridge.py \
  -q -p no:cacheprovider
```

Do not commit `.coc/` artifacts. Append their hashes and commands to the Task 7 handoff.

---

### Task 8: Compile Campaign Beginning + America with epistemic sidecars

**Files (ignored local artifacts):**
- Create: `.coc/playtests/masks-prep-20260712/staging/america/`
- Create: `.coc/module-library/masks-of-nyarlathotep-ch-america/`
- Create: `.coc/playtests/masks-prep-20260712/america-validation.json`

**Interfaces:**
- Canonical identity: `canonical_module_id=masks-of-nyarlathotep-ch-america`, `parent_module_id=masks-of-nyarlathotep`, `chapter=america`, `rules_edition=7e`, `locale=en`.
- Produces canonical seven-file Scenario IR, source evidence bundle, `epistemic-graph.json`, `reveal-contracts.json`, and `compile-confidence.json`.

- [ ] **Step 1: Establish page identity before extraction**

Create `page-map.json` from the PDF bookmarks/page labels for Campaign Beginning and America. Verify the selected zero-based indices correspond to PDF display pages 94-179 and record at least one visible anchor per subrange. Do not encode a global `printed + 3` rule.

- [ ] **Step 2: Extract chapter-local Markdown through the cache API**

Use:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 \
  plugins/coc-keeper/skills/trpg-pdf-ingest/scripts/parse_pymupdf4llm.py \
  "/Users/haoli/Documents/TRPG/coc英文/Call of Cthulhu - Masks of Nyarlathotep (Larry DiTillio, Lynn Willis, Mike Mason etc.).pdf" \
  --pages "93-178" \
  --cache-root .coc/pdf-cache --no-ocr --json \
  -o .coc/playtests/masks-prep-20260712/staging/america/chapter-local.md
```

Before executing the command, assert that `page-map.json` contains every
zero-based index from 93 through 178 exactly once for Campaign Beginning plus
America. The range was verified from this PDF's bookmarks/pages during
preflight; if the assertion fails, stop rather than changing the range by
guessing an offset.

- [ ] **Step 3: Build and review source evidence**

Write parse-manifest ranges and stable evidence segments for scenes, NPCs, clues, handouts, threats, chapter entry, and chapter resolution. Mark low-text handout/image pages `needs_review` until a targeted OCR/manual check passes. Critical conclusions require accepted range and segment states plus confidence `>= 0.80`.

- [ ] **Step 4: Compile the seven Scenario IR files**

Codex compilation agents read only their assigned chapter-local evidence and produce structured files. Require explicit `scene_edges`, at least two affordances for each social/investigation scene, three independent routes for each critical conclusion, structured NPC schedules/knowledge/disclosure, threats, pacing, and Keeper/player-safe separation. An integrator validates IDs and source refs across all seven files.

- [ ] **Step 5: Validate the canonical Scenario IR**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 \
  plugins/coc-keeper/scripts/coc_scenario_compile.py \
  .coc/playtests/masks-prep-20260712/staging/america/scenario \
  --validate --structured
```

Expected: zero error findings. Warnings must be classified and recorded; no warning affecting a critical conclusion may be waived.

- [ ] **Step 6: Compile epistemic sidecars through artifacts**

Generate `epistemic-compile-request.json`. A semantic evaluator writes a result bound to the exact request SHA; install it with `coc_epistemic_compile.py install`. Validate multi-effect clues, question lifecycle, reframe setup, confidence nodes, and no raw source/secret prose in the request/result.

- [ ] **Step 7: Register and installation-smoke America**

Register the package and safe index bundle, install into a fresh campaign, and verify the entry scene, terminal scene, source gates, epistemic sidecars, and module family lookup.

- [ ] **Step 8: Run America-related repository tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_scenario_compile.py tests/test_source_evidence_bridge.py \
  tests/test_epistemic_compiler_lifecycle_v2.py \
  tests/test_epistemic_scenario_compile.py tests/test_epistemic_blueprint_e2e.py \
  tests/test_epistemic_boundary_hardening.py tests/test_epistemic_edge_cases.py \
  tests/test_epistemic_schema_edges.py tests/test_epistemic_runtime_integration.py \
  -q -p no:cacheprovider
```

Do not commit chapter Markdown, source prose, or local module-library data.

---

### Task 9: Compile England and Egypt entry/handoff packages

**Files (ignored local artifacts):**
- Create: `.coc/module-library/masks-of-nyarlathotep-ch-england-entry/`
- Create: `.coc/module-library/masks-of-nyarlathotep-ch-egypt-entry/`
- Create: `.coc/playtests/masks-prep-20260712/handoff-validation.json`

**Interfaces:**
- Entry packages share `parent_module_id=masks-of-nyarlathotep` and explicitly declare `scope=entry_handoff_probe`, not full chapter completion.
- Each contains a validated entry scene, initial social/investigation affordances, source evidence, safe NPC/clue IDs, and minimal belief/question setup for 5-10 turns.

- [ ] **Step 1: Build source maps and extract only entry subranges**

Use page-map-driven indices for the beginning of England and Egypt. Extract only enough source to compile each chapter's arrival and first actionable hub; record the exact covered page ranges in module metadata.

- [ ] **Step 2: Compile and validate both entry packages**

Produce seven-file IR plus necessary sidecars. Reject any metadata or report language that says the full chapter is compiled or played.

- [ ] **Step 3: Register siblings and run synthetic switch smoke**

Switch a disposable America terminal campaign separately into England and Egypt. Verify state preservation and 5-10 canonical turns with fake narrator in repository tests; retain real GLM calls for Task 13.

- [ ] **Step 4: Save handoff validation evidence**

Write package hashes, source ranges, validation findings, and switch preservation manifests to `handoff-validation.json`. Do not commit local source artifacts.

---

### Task 10: GLM-5.2 canary and two isolated run sandboxes

**Files (ignored run artifacts):**
- Create: `.coc/playtests/masks-peru-america-run-a-20260712/`
- Create: `.coc/playtests/masks-peru-america-run-b-20260712/`

**Interfaces:**
- Both sandboxes install the same accepted Peru/America packages and code commit.
- Runtime v2 config is deterministic planner/rules, Pi narrator, human player.
- Run A seed base: `masks-run-a-20260712`.
- Run B seed base: `masks-run-b-20260712`.

- [ ] **Step 1: Create fresh isolated campaigns and investigators**

Do not copy mutable state from the old `masks-of-nyarlathotep` or `masks-peru-*` campaigns. Install source packages into each sandbox, create separate scenario-bound investigators, and verify no path points back to the real `.coc/campaigns` or `.coc/investigators` trees.

- [ ] **Step 2: Write explicit v2 runtime config**

Use:

```json
{
  "schema_version": 2,
  "planner": {"kind": "deterministic"},
  "rules": {"kind": "deterministic"},
  "narrator": {"kind": "pi"},
  "player": {"kind": "human"}
}
```

- [ ] **Step 3: Run one-turn GLM canaries in both sandboxes**

Submit a harmless entry observation. Require model identity exactly
`zhipu-coding/glm-5.2`, no fallback, no secret/path/protocol leak, valid
telemetry, and a durable checkpoint. Restore both sandboxes to their pre-canary
checkpoint so canary turns do not contaminate primary evidence.

- [ ] **Step 4: Run setup audits**

Validate scenario packages, source gates, session restore, player-safe state,
runtime config, and trusted driver hash. A canary authentication, quota, model,
or dependency failure is a blocker; do not fall back to another provider.

---

### Task 11: Execute spoiler-aware Run A with checkpoint repair loops

**Files (ignored run artifacts):**
- Modify: `.coc/playtests/masks-peru-america-run-a-20260712/`
- Create: `.superpowers/sdd/masks-run-a-progress.md`

**Interfaces:**
- Run kind: `diagnostic_spoiler_run`.
- Primary Codex player may read full scenario/evaluator data.
- Every accepted action has text plus structured player intent and an exact turn seed.

- [ ] **Step 1: Start the long-lived driver and verify READY**

Start with max turns 500, checkpoint interval 10, Run A seed, explicit run directory, and GLM narrator. Confirm repo root, campaign/investigator IDs, package hashes, model identity, and initial PublicState before the first action.

- [ ] **Step 2: Play one canonical action at a time**

For each turn, choose an action available through player-visible affordances even when spoiler knowledge informs route selection. Do not use typed subsystem requests unless PublicState exposes a canonical pending choice. Record why a branch is being exercised in the diagnostic-only ledger, not in player input.

- [ ] **Step 3: Review every ten turns and every transition**

Dispatch independent rules, Director/story, and prose reviewers. Reviewers cite structured evidence and classify P0/P1/P2 findings. Continue automatically when no blocker exists.

- [ ] **Step 4: Repair and replay blocking defects**

For each P0/P1, preserve the failing evidence, write a focused RED test, dispatch one fix subagent, run task review, restore the pre-defect checkpoint, and replay the same action/seed. Append old/new commit hashes and invalidated turn IDs to the defect ledger.

- [ ] **Step 5: Switch Peru to America only from accepted terminal evidence**

Use `coc_chapter_switch.switch_chapter`; verify the preservation manifest before the first America action.

- [ ] **Step 6: Complete America or reach a legitimate stop**

Stop on structured America resolution, investigator death/unplayability, unresolved security/provider blocker, or turn 500. A graph terminal without `session_ending` must be recorded as a system finding rather than padded with invented play.

- [ ] **Step 7: Generate and audit Run A artifacts**

Write the evidence receipt, diagnostic report, three checkpoint-review streams,
rulebook audit, and final accepted route ledger. Read the complete diagnostic
report end to end. Run A must never be named as a normal spoiler-blind battle
report.

---

### Task 12: Freeze the repaired revision and execute blind Run B

**Files (ignored run artifacts):**
- Modify: `.coc/playtests/masks-peru-america-run-b-20260712/`
- Create: `.superpowers/sdd/masks-run-b-progress.md`

**Interfaces:**
- Run kind: `blind_actual_play`.
- Player is a fresh subagent spawned with `fork_turns="none"` and receives only driver stdout PublicState/player Events plus its own action history.
- Evaluator findings and Run A route data are quarantined until Run B terminates.

- [ ] **Step 1: Freeze and record the Run B code/package baseline**

Run all focused tests affected by Run A repairs plus the full suite. Record Git HEAD and package/source hashes in the Run B manifest. Do not start Run B on a dirty worktree.

- [ ] **Step 2: Spawn the context-free player lane**

Give the player only role/personality, visible investigator sheet, initial player-safe briefing, action JSON schema, and the instruction to act naturally. Do not fork parent turns or mention expected routes, secrets, scene IDs, Run A, or evaluator results.

- [ ] **Step 3: Relay only player-safe turn results**

For each turn, the blind player returns player text plus its own structured intent. Validate schema and forward it unchanged. If it hesitates or forms a wrong theory, treat that as play evidence. Do not coach it toward an undiscovered clue.

- [ ] **Step 4: Quarantine checkpoint reviews**

Run the same three review lenses every ten turns, but write full findings to keeper-only review files. Return only operational errors that prevent the next turn.

- [ ] **Step 5: Handle P0/P1 defects without spoiler coaching**

Stop, invalidate, fix, and replay the affected segment. The blind player receives the same pre-defect safe context and is asked to repeat/choose its action without seeing the cause or expected outcome.

- [ ] **Step 6: Complete or document the blind stall**

If the player reaches turn 500 or becomes stuck without a viable discovered action, stop without hints. Record known clues, attempted routes, last viable affordances, hidden available routes, and whether the block is mechanical or signposting-related.

- [ ] **Step 7: Generate and audit Run B artifacts**

Recompute evidence eligibility. Produce `battle-report.md` only when eligible;
otherwise use `verification-sample.md`. Read the complete output and rulebook
audit end to end before accepting it.

---

### Task 13: Real GLM chapter handoff probes

**Files (ignored run artifacts):**
- Create: `.coc/playtests/masks-america-england-probe-20260712/`
- Create: `.coc/playtests/masks-america-egypt-probe-20260712/`

**Interfaces:**
- Each probe forks the accepted America terminal checkpoint.
- Each runs 5-10 real GLM-5.2 narrated canonical turns.

- [ ] **Step 1: Fork the America terminal checkpoint twice**

Verify the two forks have identical pre-switch state hashes and no shared mutable paths.

- [ ] **Step 2: Switch one fork to England and one to Egypt**

Require successful preservation manifests, correct entry scene/source bundle,
and distinct chapter history rows.

- [ ] **Step 3: Play and evaluate 5-10 turns per probe**

Check HP, SAN, injury, inventory, cash, clues, NPC knowledge, threats,
belief/questions, memories, language, provenance, Director choices, and GLM
prose. Do not claim full chapter play.

- [ ] **Step 4: Write the chapter transition report**

Bind every pass/fail claim to pre/post state hashes, chapter history, event IDs,
and source/module identities.

---

### Task 14: Three-axis final evaluation, route comparison, and terminal validation

**Files:**
- Create: `docs/status/MASKS-WHITEBOX-PLAYTEST.md`
- Modify: `CHANGELOG.md`
- Test: all `tests/`

**Interfaces:**
- Produces final rule, story/orchestration, and prose scores from 0-100.
- Produces spoiler-vs-blind route comparison with exact evidence refs.
- Separates system defects, module-data defects, model-output defects, and test-infrastructure defects.

- [ ] **Step 1: Generate semantic route-comparison request/result**

Build the request from structured Run A/B route ledgers. An independent
evaluator classifies every Run-A-only route with a bound request SHA and
reasons. Reject missing/duplicate/unclassified routes.

- [ ] **Step 2: Dispatch four final read-only reviewers**

Review lanes:

1. CoC rules and provenance;
2. Director/story interest and blind-player fairness;
3. Chinese prose naturalness and secret separation;
4. checkpoint/evidence/runtime security.

Actionable findings return to one fix subagent, followed by focused replay and re-review.

- [ ] **Step 3: Write the public status report**

Summarize source/run identities, exact turns, terminal states, repairs and
replays, three scores, strongest/weakest moments, route comparison, chapter
probe results, unresolved limitations, and links to local artifacts. Quote only
short excerpts from reports read end to end. Do not reproduce source PDF prose.

- [ ] **Step 4: Run all final gates**

```bash
git diff --check
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_plugin_metadata.py -q -p no:cacheprovider
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_interactive_playtest.py tests/test_playtest_checkpoint.py \
  tests/test_playtest_route_compare.py tests/test_chapter_switch.py \
  tests/test_playtest_evidence.py tests/test_playtest_report.py \
  tests/test_playtest_audit.py -q -p no:cacheprovider
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/ -q -p no:cacheprovider
npm ci --prefix runtime/adapters/pi
npm ci --prefix runtime/adapters/player
npm ci --prefix runtime/adapters/narrator
npm test --prefix runtime/adapters/narrator
```

Expected: zero failures. Record exact test counts and warnings.

- [ ] **Step 5: Commit the final tracked report**

```bash
git add docs/status/MASKS-WHITEBOX-PLAYTEST.md CHANGELOG.md
git commit -m "docs(playtest): report Masks white-box campaign results"
```

- [ ] **Step 6: Confirm terminal workspace state**

Require a clean worktree, all plan tasks complete, local run artifacts
contained under `.coc/playtests/`, no raw source files tracked, and no push or
deployment performed without a new explicit request.
