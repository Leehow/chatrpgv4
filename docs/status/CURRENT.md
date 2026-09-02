# COC Keeper Current Status

**Last updated:** 2026-09-02 (chase settled live)

**Current manifest version:** `0.4.0-alpha.0`

**Release name:** `0.4.0a`

**Release tag:** not created

> This file is the repository's only live status source. Historical plans,
> audits, old run artifacts, and tagged release notes do not override it.

## Release posture

- `plugins/coc-keeper/` is the only canonical plugin. AI-coding hosts
  (including Codex, Claude Code, Cursor, Grok Build, Kimi, and ZCode) and the
  Pi/headless Keeper use the same skill tree, toolbox registry, rules, state,
  advisory, narration, and evidence contracts. A capability available on only
  one of those surfaces is not a completed product capability. Grok Build
  play installs the full plugin (`./skills/`), not a thin entry alone.
- Cursor, Kimi, and ZCode also use the shared stdio MCP gateway under
  `plugins/coc-keeper/mcp/`; it is a transport over the canonical toolbox, not a
  second rules or state engine. Host-native differences are declared in
  `references/host-capabilities.json`.
- Investigator portraits use the current host's built-in image tool when one
  exists (`HOST_NATIVE_IMAGEGEN`); hosts without image tools skip portraits.
- The White War and The Haunting are packaged as play-ready starters. The
  Haunting distribution basis and plugin-image provenance remain `UNVERIFIED`;
  see `CONTENT_LICENSES.md`.
- Historical scripted players, fixed profiles, evaluation matrices, suite
  aggregators, and parallel report generators are not part of the 0.4.0a test
  strategy.
- Runtime saves must match the exact current schema. Old or mismatched runtime
  state is rejected and replaced with a fresh campaign generation; historical
  reports remain read-only evidence.

## Pi-Coc RuleGraph cutover (`ACTIVE_IMPLEMENTATION_TRACK=pi-coc`)

Integration branch `0.8.1a` at `c07f6ad5` (the family-projector lane
`claude/pi-coc-family-projectors-20260831` is merged and kept in sync). Note that `0.8.1a` is a branch name; the plugin
manifest version above is unchanged and remains authoritative.

**Compiled and promoted — all ten families.** healing, core-check, push-luck,
social, psychology, combat, chase, sanity, magic, development are source-bound
in the production CoC7 RuleGraph (434 nodes / 668 relations), all
`family_runtime_ownership=graph`, all `legacy_surface_lifecycle=hidden`.
`rules.context` and `rules.settle` are the normal Keeper surface.

**Promoted is not playable.** A family counts as playable only after a fresh
normal-profile `pi-coc --mode rpc` turn settles it with no fixture, seed,
injected trigger, or legacy operation (spec §14 Gate 9):

| Family | State |
| --- | --- |
| Development, Social | passed Gate 9 |
| Core-check | settled naturally, but predates the corrected bundled-Pi launcher |
| Push/Luck, Psychology, Sanity, Combat, Healing | settled live after the delivery fixes (16 KB wire overflow, dropped `semantic_inputs`, chase/combat NPC mechanics); recorded in `tests/fixtures/rules-settle-recorded/` (55 payloads, 8 families) and replayed by `tests/pi/rules-settle-recorded-projection.mjs` |
| Chase | **settled live 2026-09-02** — `decision:coc7:chase:start`, recorded in the corpus; see below for the six doors it took |
| Magic | **no recorded settlement** — a tome spell-inventory content gap |

**Chase settled, and what it took.** The `combat:flee → chase:start`
continuation (132fb7c3) was necessary and not sufficient. Five more doors
stood behind it, each surfaced by a seeded probe and none visible from the
code alone:

1. The lane's resume prompt is a turn, and a Keeper handed a turn plays it —
   prompt strengthening did not help; the resume surface is now structurally
   restricted to `session.resume`.
2. The lane's own prompt reached the extension as a user message, releasing
   that restriction immediately; host prompts are marked now.
3. `chase_candidate_invalid` named neither the present actors nor the
   connected locations, so the Keeper re-guessed the same refs. Told the
   lists, it corrected both on the next attempt.
4. The settle adapter map was keyed by the compiler's command kinds
   (`chase_start`…) rather than the capability the graph declares
   (`chase.execute`): all six chase decisions could never reach the executor.
5. The resolver index had the identical spelling problem, so fixing the map
   only moved the refusal one step later.
6. `chase_id` was undeclared on `rules.settle`, so the FIRST successful chase
   start — canonical state written, chase.json active — reached the Keeper as
   `semantic_identity_unavailable`. It retried, went stale, and finalized a
   turn that had begun a chase it could not see.

A turn on that lane took 255–540 s against the 180 s budget, inflated by the
Keeper working around those doors; not re-measured since they closed.

**The earlier reading, kept because it was wrong in an instructive way.** A seeded diagnostic lane
(2026-09-02) put the investigator in `corbitt-confrontation` with Walter
Corbitt present and had the player flee. `rules.context` with family `chase`
answers `decision:coc7:chase:start` in that exact campaign state, so the
pipeline is not the blocker. The Keeper asks for family `combat` instead and
reads the flight as `decision:coc7:combat:flee` — and the graph has no
`continues-as` from `combat:flee` to `chase:start`, so nothing routes the
settled flight into a chase. The same shape as the missing Social → Push
relation: a source-graph completeness gap at a family junction, and the next
chase work is that relation with its rulebook evidence, not more play.

**Fine-grained live coverage: 10 of 43 decisions.** Family-level coverage
overstates it. Recorded live settlements cover `core-check:ordinary-check`,
`sanity:check`, `social:adjudicate-difficulty`,
`development:end-session`, `push-luck:pushed-roll`, `combat:attack`,
`combat:end`, `healing:first-aid-ordinary` and
`psychology:observe-concealed` and `chase:start`. The other 33 decisions —
the five remaining chase decisions, every magic decision, combat aim/defend/flee/maneuver/reload/context, both dying
clocks, medicine and weekly recovery, opposed and combined checks, luck-roll
and luck-spend, the whole sanity bout chain, and `development:settle-ending`
— have never settled in a real turn.

**Ending is reached through `rules.settle`.** `state.end_session` is
host-private; the Keeper settles `decision:coc7:development:end-session`. The
Pi phase machine only flipped to `ending` on the host-private name until
`dc28bf4c`, so a settled ending used to leave the table in `live_turn` with no
closure tools.

**`/system debug run` can seed a situation** (`situation` on the run or per
lane: structural `scene_id` / `npc_presence` / `clue_ids` / `flags`, validated
against the sealed campaign tables, or `establish_from_prompt`). Seeding is
applied after the resume settles, through the canonical toolbox, and is
recorded in `final.json`; it makes a deep family reachable from turn 1 in one
lane. It is diagnostic-only and is not Gate 9. See
`docs/specs/pi-coc-debug-experiment.md`.

**Per-turn budget: 180 s, currently missed.** Across the 44 preserved Gate 9
evidence turns: median 103 s, and **16 of 44 hit the timeout**. Host tool
execution is ~2 s median (≈2 % of a turn); the rest is model/provider time.
Timed-out turns averaged 15.8 tool calls vs 9.4 for settled turns, so
round-trip count is the lever, not graph cost. Every avoidable `rules.settle`
rejection costs one round trip. See spec §16.1.

### Open items

1. Closed model-view projectors exist for social, development/end-session,
   push-luck/pushed-roll, psychology/observe-concealed, sanity/check and
   combat. Healing settles through the generic projection; chase and magic
   have no recorded settlement to build one against.
2. ~~`tests/pi/normal-model-id-boundary.mjs` still fails.~~ **Closed.** The
   `invoke_via` half was fixed by `c21cd5a7`. The TextGraph merge then
   published `narration.review.findings.rule_id` into a domain no identity
   grammar claimed, and fixing that unmasked a stale `roll_id` assertion that
   `33290a09` had deliberately reversed. The suite now passes end to end.
3. ~~The system ontology registry's module coverage row describes a
   "healing-only" RuleGraph.~~ **Closed.** That row now reads "ten
   source-accepted families" and no longer contradicts the rule row beside it.
   ADR 0003's amendment still cites the old wording as outstanding, and is
   itself stale on this point.
4. The production RuleGraph has no explicit Social → Push `continues-as`
   relation. Runtime continuation works through the canonical failed-check
   grant, so this is a source-graph/Ontology completeness gap, not a live bug.
5. `decision:coc7:development:settle-ending` has no production projection and
   no Gate 9 proof; only `end-session` does.
6. Rotate the `openai-codex` and `qoder-cn` OAuth credentials — one earlier
   diagnostic printed their refresh fields before redaction; the xAI credential
   was re-issued. No credential was committed.
7. TextGraph T0–T5 is merged. Gate 1's live half was blocked on mechanics
   chrome being a closed three-language table; that is now fixed —
   `setup.player_vocabulary` lets a campaign carry chrome in any language, and
   ja-JP no longer renders English bodies under Japanese tags. What remains is
   gate 2 itself: a non-`zh-Hans` table played end to end with a live Keeper,
   which no fixture can stand in for. Gate 3 depends on gate 4, and gate 4 is
   answered rather than measured — see
   `docs/status/why-narration-review-fired-zero-times.md`.

8. The pre-existing `0.8.1a` test debt is cleared except one file.
   `tests/test_pi_package.py` is 186/187, and the whole `tests/pi` suite
   passes through its own wrappers. Five of those failures were real product
   defects, now fixed with covering tests: a model-authored compiler receipt
   accepted on the typed narration.review surface before its binding armed; a
   ready source-bound `state.move_scene` collapsing to
   `semantic_identity_unavailable` because the embedded scene bundle, the
   result's `campaign_id` and the source mentions' `ref_id` were undeclared;
   the leaf worker's `status=abstain` rewritten to `usable`, turning an
   abstention into fulfilled coverage; the generic invoke surface missing the
   host-owned scene-write key; and `coc_capabilities` failing the identity
   boundary on its own contract digest, which broke the first call of a clean
   packed install.
   Still failing: `tests/pi/auto-dispatch-smoke.mjs`, down from a crash in its
   second block to 14 failing checks, all in the opening-route family. Each
   remaining one needs a judgment call about what the check should probe now
   that the host-local typed role gates setup and play operations
   independently of the retained route.
9. A checkout whose `runtime/adapters/keeper/node_modules` predates
   `f596864c` carries only half of the vendored Pi patch; `patch-package`
   then refuses the whole package and the agent-loop replan hooks stay
   missing. Reinstall (`npm ci`) when no Keeper session runs from that
   checkout, or apply the missing hunks alone.
10. ~~The obligation namespace still has copies outside its owner.~~
    **Partly repaired.** The TypeScript declarations are gone: `coc_text_graph.py
    project` generates `obligation-namespace.generated.ts` from the graph and
    the projection imports it, dropping that file's obligation-prefix count
    63 -> 54, with a drift test forcing regeneration and the generated file
    itself inside the scanned surface. What remains is not the same kind of
    thing: three single-site Python usages that construct ids in the namespace,
    and three model-facing copies in `host-system-play.md`, `SKILL.md` and
    `turn-tooling-and-typed-ops.md` — prompts have to name the namespaces for
    the Keeper, so those are documentation, not duplicate declarations.

11. ~~The agency gate may have been retired by accident.~~ **Answered, and
    the premise was wrong.** `ab634acd` retired the second narration/rewrite
    pass deliberately and updated `test_turn_finalization.py` in the same
    commit to assert `agency_review_required is False`; it simply missed
    `tests/test_narration_budget.py`. That file's 17 failures are closed: a
    `pi_review_enabled` fixture keeps the still-present review machinery
    covered, and one unrelated failure needed `involuntary_action`, required
    on `rules.sanity_check` since `b8534c8c`. What remains true and worth
    watching is that `narration.review`'s schema still calls
    `agency_violation` "the only hard gate" while the operation is not offered
    in normal play — the descriptions now say so explicitly, but the wording
    inside `findings.rule_id` has not been revisited.

## Whole-product acceptance

The only canonical global test is a real plugin-native session:

1. The main Codex opens the canonical COC Keeper plugin and acts as KP through
   `coc-main` and `coc-keeper-play`.
2. The run uses a fresh isolated workspace and an exact-current-schema campaign.
3. A collaboration subagent created with `fork_turns: "none"` acts as the
   player. It receives only player-visible narration, character information,
   public rolls, and explicit choices.
4. Play continues to structured terminal evidence, or records a concrete
   operational blocker without converting missing evidence into success.
5. `coc-export-battle-report` alone writes the final readable
   `artifacts/battle-report.md` and its completeness evidence.

The collaboration subagent shares the filesystem with the main Codex. The
isolation claim is therefore protocol-enforced no-context/player-safe relay,
not a cryptographic sandbox.

## Deterministic verification

pytest remains the right tool for claims with deterministic or structural
answers:

- rules, dice, HP/SAN, and skill arithmetic;
- transactional, idempotent state writes and exact schemas;
- path safety and secret/public data contracts;
- plugin metadata and single-track packaging;
- PDF source-bundle hashing, evidence, hydration, and drift rejection;
- production subsystem and runtime adapter interfaces.

These checks are contract evidence. They are not a simulated player, actual
gameplay, or a battle report.

## PDF source-bundle boundary

PDF rendering, visual review, text/asset extraction, and page evidence belong
to an external host PDF skill. Prefer the host's existing PDF capability when
it can meet the contract; otherwise recommend the open-source Codex workflow
at `openai/skills` curated `pdf`. The repository has no PDF parser or OCR
fallback and no PDF parsing dependency.

The external skill must produce the versioned source-bundle contract with
`producer: codex-pdf-skill` (contract identity, not a Codex-only runtime
requirement), original PDF identity/hash, explicit zero-based page indexes,
Markdown/hash entries, accepted review state, realistic parse confidence,
grep anchors, and asset hashes. `coc_pdf_bundle.py` only validates and
deterministically reformats that evidence. Binding persists `bundle_sha256`;
hydration rejects later drift.

### Progressive module parse (design + slice 1 store)

Approved direction for player PDFs: skeleton-first map + on-demand deep packs +
durable `.coc/module-assets/` reuse across campaigns. Contract:
`docs/active-plans/coc-on-demand-module-skeleton.md`.

**Slices 1–8 (done — progressive vertical):**

- `coc_module_assets.py` — durable `.coc/module-assets/` store
- `coc_module_project.py` — skeleton / opening-deep / on-enter hot-ring
- `coc_module_reuse.py` — **reuse by file_sha256**, library link, **process-queue**
- `state.move_scene` progressive on-enter; `scene.map` parse_state
- Host workflow in `trpg-pdf-ingest` / `coc-scenario-import`
- Tests: `test_module_assets`, `test_module_project`, `test_module_reuse`

Production starters/complete chapters still use seven-file compile +
`module-library` install. Progressive path reuses deep packs across campaigns
via `module-assets` without re-extract when `file_sha256` hits.

## Supported product surface

- The Keeper LLM drives normal play through canonical skills and the shared
  `coc_toolbox.py` registry.
- Deterministic tools enforce only rules arithmetic, transactional state, and
  read-only/secret module truth. Narrative advice remains warnings and hints.
- `runtime/` exposes the open headless Event SDK. Its canonical headless turn
  path is the same skills-enabled Keeper agent and `coc_toolbox.py` registry.
  Name the three surfaces explicitly: **Pi Package**
  (`plugins/coc-keeper/pi/`), **Headless Runtime** (`runtime/`), **Narrator
  Bridge** (`runtime/adapters/pi/`, **frozen** compatibility only — keep, do
  not expand or treat as the Pi product; deletion is a later deprecation).
- The canonical toolbox now exposes rich optional Director plans, the existing
  Storylet scheduler, NPC agency, personal-horror hooks, threat clocks,
  epistemic questions/belief application, full ChaseSession/SanitySession
  commands, player-safe narration briefs, semantic narration review, and
  advisory-adoption evidence. Advice remains optional and never becomes a
  fixed turn pipeline or narrative gate.
- Narration briefs preserve the current player declaration as player-safe
  `action_uptake` evidence and merge already-settled direct roll receipts. The
  Keeper enacts committed methods, precautions, constraints, and meaningful
  speech in the fictional world before or alongside their outcome; semantic
  review remains advisory and never forces meta or hypothetical text into play.
- Player-action uptake is an always-active canonical Keeper prompt contract,
  not a feature switched on by `narration.brief` or `narration.review`. It
  applies with or without dice and on both AI-coding and Pi/headless hosts;
  optional narration tools may reinforce it but never own it.
- Narration grounding reconciles an adopted plan with the current canonical
  active scene. A host that omits a settled `state.move_scene` receipt from the
  optional `applied_events` list can no longer produce an envelope whose scene
  anchor names the new location while its grounding incorrectly orders the
  Keeper to narrate the old one.
- `battle-report.md` is the player-readable report and contains no intermediate
  JSON. `battle-report-evidence.json` is Keeper-internal development evidence;
  it preserves structured per-turn tool results and adoption receipts.

## Known release risks

- The Haunting distribution basis and plugin-image provenance are
  `UNVERIFIED`.
- A release candidate is not accepted until a fresh real plugin/subagent run
  reaches terminal evidence and its final report completeness receipt passes.
- Focused real-host probes now show action uptake and deterministic roll
  projection on both Codex and Pi. They do not replace a fresh natural-need
  session reaching terminal report evidence on both surfaces, so 0.4.0a does
  not yet claim full cross-host experience parity.
- Context-free subagent isolation is not filesystem isolation; player-safe
  relay discipline remains part of the acceptance procedure.

## Verification entry points

```bash
uv sync --frozen --dev
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest \
  tests/test_plugin_metadata.py tests/test_release_consistency.py \
  -q -p no:cacheprovider
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest \
  tests -q -p no:cacheprovider
git ls-files 'checks/ocr-cached/**' 'checks/py4llm-cached/**'
```

The tracked-file command must print nothing. See `CHANGELOG.md` for the current
release delta.
