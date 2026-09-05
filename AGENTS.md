# Project Rules — shared by Codex and Pi coding agents

This file governs work in this repository. The coding host (Codex/Pi), the development track (Codex-hosted product/Pi-Coc), and the runtime role (developer/KP/player/onboarding) are separate choices. Use the current host's real tools; do not assume another host's tool names or permission mechanism exists. `AGENTS.override.md` is also read by Pi and is not a Codex-only switch.

## Authority And Required Routing

Keep this entrypoint small enough to load in both hosts. Read the applicable contract below before that work; do not read every route at startup. References retain binding product requirements without granting additional actions.

| Work | Required source |
| --- | --- |
| Keeper behavior, rules/state boundaries, semantic IDs, prompt or product-law review | [Keeper product law](docs/agents/product-law.md) |
| Authorized feature implementation, repair or integration | [Development contract](docs/agents/development.md) and the affected canonical skill |
| Product document/module extraction or PDF bundles | [Source processing](docs/agents/source-processing.md), `plugins/coc-keeper/skills/trpg-pdf-ingest/SKILL.md` |
| Pi-Coc 开桌 / 实机测试 / 端到端验收 | [Pi-Coc Playtest Method](docs/agents/pi-coc-acceptance.md) |
| **Never destroy playtest evidence without authorization** (permanent project law; violated four times) | [Pi-Coc Playtest Method](docs/agents/pi-coc-acceptance.md) |
| Explicit Codex-track product acceptance | [Codex acceptance](docs/agents/codex-acceptance.md) |
| Launchers, onboarding/play roles or persistence | [Pi runtime](docs/agents/pi-runtime.md) |
| Provider thinking integration | [Provider notes](docs/agents/provider-notes.md) for that provider only |
| Selecting/running validation | [Validation](docs/agents/validation.md); focused checks unless the full suite is needed |
| Activate/create/resume COC | `plugins/coc-keeper/skills/coc-main/SKILL.md` |
| Live Keeper craft | `plugins/coc-keeper/skills/coc-keeper-play/SKILL.md` |
| Scenario import | `plugins/coc-keeper/skills/coc-scenario-import/SKILL.md` |
| Inspect/mutate campaign state | `plugins/coc-keeper/skills/coc-campaign-state/SKILL.md` |
| Final report | `plugins/coc-keeper/skills/coc-export-battle-report/SKILL.md` |
| Ruleset changes | `docs/ruleset-contract.md` and the affected ruleset |

Use the one canonical plugin; do not create another engine, facade, harness or policy tree. Report a missing required source or a real conflict rather than inventing a substitute. Ordinary analysis remains read-only; implementation requires the user's authorization.

## Pi home isolation (binding)

Pi is fully isolated inside this repository. Never use `~/.pi/agent`,
`~/.pi/coc-agent`, or another project's `.pi/`.

- Coding (`pi` / PipiUI): `{this-repo}/.pi/agent`
- COC play (`pi-coc`): `{this-repo}/.pi/coc-agent`

Find this project's own home. Do not `pi install` the COC package into a
global `settings.json`, and do not symlink this home back to `~/.pi`.

## Codex And Pi-Coc Development Track Lock

This repository has two distinct host development tracks:

1. **Codex track** — the Codex-hosted COC workflow.
2. **Pi-Coc track** — the Pi-hosted workflow launched through `pi-coc`.

They share one canonical plugin and rules kernel, but they are separate
development scopes. Never treat work requested for one track as permission to
modify, repair, synchronize, or redesign the other track.

The standing default is `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`. Declare that
lock and proceed. Do not ask which track to use for ordinary work.

Ask the user exactly `继续开发 Codex 版还是 pi-coc 版？` only when the user
explicitly names the Codex track, or the requested work is confined to
Codex-host implementation, adapters, prompts, launchers, tests, or
documentation. Do not treat prior conversation, a dirty tree, a worker
handoff, an apparently obvious target, or a request to “继续” as a Codex
switch. After an explicit Codex switch, declare
`ACTIVE_IMPLEMENTATION_TRACK=codex`; otherwise keep `pi-coc`. Keep the
declared track locked for the entire task:

- With `ACTIVE_IMPLEMENTATION_TRACK=codex`, Pi-Coc implementation, adapters,
  prompts, launchers, tests, and documentation are off-limits.
- With `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`, Codex-host implementation,
  adapters, prompts, launchers, tests, and documentation are off-limits.
- Shared kernel, state, registry, contract, or skill files are **cross-track
  scope**. They are off-limits by default after either selection. If the chosen
  track cannot be completed without changing a shared file, stop, name the
  exact file and reason, and obtain explicit user authorization before editing
  it.
- Every worker prompt, handoff, review, and validation report must state the
  active track and its off-limits opposite track.
- Tests may inspect the opposite track only for non-regression when necessary;
  they must not update its fixtures, expectations, snapshots, or behavior.
- Never switch tracks mid-task. If a new request appears to target the other
  track, stop and ask the user to confirm a new track lock before continuing.
- If the worktree already contains unknown or concurrent edits from the
  opposite or cross-track scope, do not absorb, clean, revert, complete, or
  commit them. Report the conflict and wait for direction.

Any result that edits the opposite track, or that edits shared files without
explicit authorization, is `invalid-for-integration` for both tracks, even if
component tests pass. Ordinary pi-coc work does not require a spoken
per-task track choice.

## Standing Memory: Preserve Playtest Evidence

Campaigns, transcripts, tool logs, investigator state and source bundles are evidence. Never delete them to start a fresh test, because a schema changed, or because a report was exported. Create a new campaign identity; deletion requires explicit user authorization. Reusable source/module caches stay intact. `coc-export-battle-report` is the sole final owner of `artifacts/battle-report.md` and `artifacts/battle-report-evidence.json`; a handwritten summary is a draft, not accepted evidence. Never reconstruct lost rolls or logs from memory. This survives compaction and handoff.

## Shared product invariants

- PDF source extraction belongs to an external host PDF skill and its validated source bundle. The repository has no PDF parser or OCR fallback; it may verify file identity but must not implement extraction or infer source quality.
- The KP is the product: semantic intent, causality, NPC craft and narration belong to the live KP. Rules own arithmetic; state owns transactional/idempotent persistence. Module truth remains read-only and secret until legitimately revealed.
- A settled player output comes from one hash-bound finalization receipt after authoritative writes. Completeness does not authorize a second narrative judge, mandatory tool choreography or suppression of player agency.
- Player knowledge boundary: KP owns the intercept. A lucky correct guess stays a guess; do not ban players from guessing or treat their assertion as discovered module truth.
- Player-visible prose uses active `play_language`; no fixed phrase tables decide intent, quality, NPC hostility or clue relevance. Improvisation preserves both assertions and provenance as campaign-local continuity debt rather than silently rewriting source.
- Exceptional rolls require source-bound effects and traceable public evidence; each material investigator/NPC first contact owns its one immutable receipt. Read the full product law before changing these contracts.
- Model-facing identifiers are semantic IDs. Runtime code owns opaque hashes and integrity checks; do not require a model to copy random bytes between calls.
- Host limitations are explicit; deterministic tests do not prove real play or cross-host equivalence. Source/build/package/runtime and real user acceptance are distinct evidence.

## COC Plugin Single-Track Law

`plugins/coc-keeper/` is the sole plugin for every host. Never create a
host-specific copy, alternate toolbox, reduced Pi facade, or forked path.

- Rule systems are packages under `plugins/coc-keeper/rulesets/<id>/` per
  `docs/ruleset-contract.md`; `coc7` is the reference package. Kernel state,
  dispatch, advisory, module, and runtime machinery stays ruleset-agnostic.
- CoC-specific SAN, Mythos, and dice craft bind `coc7` campaigns. Architecture
  rules—KP is the product, semantic authority, advisory boundaries, real
  acceptance, and no fake-KP—bind every ruleset.
- AI-coding hosts and Pi/headless are one product. A capability is complete only
  when its applicability, consumer, effects, and evidence are equivalent and
  validated across relevant surfaces.
- A platform limitation must be explicit and gated, never a silent weaker KP.
  Portraits use the current host's built-in image tool or are skipped; never
  route through another host. The gate is `HOST_NATIVE_IMAGEGEN` in
  `rulesets/coc7/skills/coc-character/SKILL.md`.

## User Intent Over Deliverables (Read First)

**Deliverables serve intent; intent does not exist to produce deliverables.**
Before large work, restate the user's job, success condition, and what would be
hollow even if files, tests, turns, or reports look complete.

- Prefer fewer real steps over synthetic volume. Counts, coverage, tests,
  reports, and status files are evidence only after method matches intent.
- Keep user requirements, observed facts, inferences, and proposals distinct.
  Ask only when a real ambiguity would materially change scope or behavior.
- Never invent an easier goal, continue a known-wrong path because it has
  artifacts, or polish an answer to a different question.
- On intent skew, stop, name the mismatch, re-anchor on the user's actual job,
  and label non-serving artifacts `invalid-for-intent` and, when applicable,
  `invalid-for-acceptance`. Do not launder them into progress.
- Grok-family models must write before multi-step work: “User is trying to ___.
  Success looks like ___. Hollow delivery would be ___.” Summaries emphasizing
  “finish N turns” or “export a report” are suspect until rechecked.


## Python Interpreter Contract

The only environment is CPython 3.14.6, declared exactly by `.python-version`
and `project.requires-python`; dependencies come only from committed `uv.lock`.

- Install and use exactly uv 0.11.16; bootstrap with
  `uv sync --frozen --dev`.
- Run every repository Python command from the root as
  `uv run --frozen python ...`. From elsewhere, add
  `--project <repo-root>` before `--frozen`.
- Python children use `sys.executable`. Versioned JSON registries use
  `{python}`, resolved by their owning runtime; never select `python` or
  `python3` from `PATH`.
- `#!/usr/bin/env python3` shebangs are portability metadata, not an approved
  repository invocation path.
- A Python/dependency upgrade is one atomic contract change across
  `.python-version`, `pyproject.toml`, `uv.lock`, CI, active docs, and contract
  tests. Never broaden the exact version constraint.
