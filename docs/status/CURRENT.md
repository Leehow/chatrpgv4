# COC Keeper Current Status

**Last updated:** 2026-07-17

**Current manifest version:** `0.4.0-alpha.0`

**Release name:** `0.4.0a`

**Release tag:** not created

> This file is the repository's only live status source. Historical plans,
> audits, old run artifacts, and tagged release notes do not override it.

## Release posture

- `plugins/coc-keeper/` is the only canonical plugin. Codex, Claude Code, and
  Cursor use thin host metadata over the same skills and runtime tools.
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

PDF rendering, OCR, layout recognition, text extraction, and asset extraction
belong to an external host PDF skill. Codex normally supplies its `pdf` skill.
The repository has no PDF parser or OCR fallback and no PDF parsing dependency.

The external skill must produce the versioned source-bundle contract with
`producer: codex-pdf-skill`, original PDF identity/hash, explicit zero-based
page indexes, Markdown/hash entries, accepted review state, realistic parse
confidence, grep anchors, and asset hashes. `coc_pdf_bundle.py` only validates
and deterministically reformats that evidence. Binding persists
`bundle_sha256`; hydration rejects later drift.

## Supported product surface

- The Keeper LLM drives normal play through canonical skills and the shared
  `coc_toolbox.py` registry.
- Deterministic tools enforce only rules arithmetic, transactional state, and
  read-only/secret module truth. Narrative advice remains warnings and hints.
- `runtime/` exposes the open headless Event SDK and debug/Pi adapters without
  forking keeper skills or rules.
- Optional epistemic sidecars can carry source provenance, semantic compilation,
  belief updates, question lifecycle, cognitive Storylets, least-privilege
  narrator projection, and replayable metrics.

## Known release risks

- The Haunting distribution basis and plugin-image provenance are
  `UNVERIFIED`.
- A release candidate is not accepted until a fresh real plugin/subagent run
  reaches terminal evidence and its final report completeness receipt passes.
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
