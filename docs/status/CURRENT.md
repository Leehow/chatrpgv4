# COC Keeper Current Status

**Last updated:** 2026-07-17

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
- `runtime/` exposes the open headless Event SDK. Its canonical Pi/headless turn
  path is the same skills-enabled Keeper agent and `coc_toolbox.py` registry;
  the narrow `runtime/adapters/pi/` narrator bridge is a compatibility
  component, not a second or reduced Keeper product.
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
