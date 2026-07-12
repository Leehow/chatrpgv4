# Masks Whitebox Playtest — Status

Updated: 2026-07-12 (Phase 3 closed — disk reconciled; no long-run restart)

## Model attestation policy (hard)

| Role | Required identity | Notes |
|------|-------------------|--------|
| KP / Narrator | `zhipu-coding` / `glm-5.2` only | No silent stronger substitute; attestation failure → replay, never continue on fallback as a valid turn |
| Player | This agent via `coc_interactive_playtest` JSONL | `runtime.player.kind = human`; **no GPT / OpenAI / Codex player lane** |
| Evaluators | Non-GPT preferred | Structured rules audit + local evidence |

## Acceptance criteria 1–11

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Packages/gates | **Pass** — Peru/America validate_scenario `errors=[]`, critical holds empty/0 (prep artifacts under `.coc/playtests/masks-prep-20260712/`) |
| 2 | GLM canary | **Pass** — `masks-peru-america-run-a-20260712/canary-result.json` (`ok=true`, `zhipu-coding/glm-5.2`, `deterministic_fallback=false`) |
| 3 | Run A Peru+America | **Pass** — aggregate **99** turns; Peru tip `primary-run/checkpoints/turn-000038` @ `peru-resolution` → chapter switch → America tip `america-continuation/checkpoints/turn-000061` @ `america-resolution` |
| 4 | Run B blind | **Pass** — isolated `masks-peru-america-run-b-20260712`; Peru 38 + America 42 = **80** turns; `harness-state.chapter=america-complete`; tip @ `america-resolution`; 0 accepted-turn attestation failures |
| 5 | Route compare | **Pass** — structured ledgers + artifact-mediated semantic result; A-only edge `lima-museum->puno-hub` classified `optional` (B used `lima-museum->travel-to-puno->puno-hub`) |
| 6 | England/Egypt probes | **Pass** — 6 GLM turns each; entries `england-arrival` / `egypt-arrival`; 0 attestation failures |
| 7 | Blocking fixes + regression | **Pass** — flag/move/resume/chapter-switch/registry pin; focused tests green |
| 8 | Three-axis scores | **Pass** — final scores below (structured evidence only) |
| 9 | Tests | Focused evidence/route/chapter/metadata green after registry pin |
| 10 | Evidence naming | **Pass** — Run A → `diagnostic-play-report.md` only. Run B → `verification-sample.md` (**not** `battle-report.md`) because recomputed receipt is ineligible |
| 11 | No copyrighted prose in git | **Pass** |

**Run B battle-report eligibility:** **Ineligible** — recomputed interactive evidence receipt fails on `narrator_secret_audit_invalid` (interactive driver did not persist narrator `secret_audit` receipts into `runner-invocations.jsonl`). Accepted-turn KP attestation itself is clean (`zhipu-coding/glm-5.2`, `deterministic_fallback=false` on all accepted actions). No segment replay required for hash/fallback breakage; the gap is evidence-export infrastructure, not a dead process / broken action chain.

## Run A (frozen diagnostic)

- Path: `.coc/playtests/masks-peru-america-run-a-20260712/`
- Report: `artifacts/diagnostic-play-report.md` + `artifacts/freeze-receipt.json` + `artifacts/evidence-summary.json`
- Peru tip: `primary-run/checkpoints/turn-000038` @ `peru-resolution`
- America tip: `america-continuation/checkpoints/turn-000061` @ `america-resolution`
- KP on all accepted turns: `zhipu-coding/glm-5.2`, `deterministic_fallback=false`
- Chapter switch: verified (`chapter-switch-result.json`)

## Run B (blind, isolated)

- Path: `.coc/playtests/masks-peru-america-run-b-20260712/`
- Seed: `masks-run-b-20260712`; campaign/investigator remapped; no GPT player
- Tips: Peru `primary-run/checkpoints/turn-000038` @ `peru-resolution`; America `america-continuation/checkpoints/turn-000042` @ `america-resolution`
- Harness: `total_turns=80`, `chapter=america-complete`, `blocker=null`
- Report: `artifacts/verification-sample.md` + `artifacts/freeze-receipt.json` + `artifacts/evidence-summary.json`
- Formal eligible: **false** (`narrator_secret_audit_invalid`)

## Handoff probes

- Path: `.coc/playtests/masks-handoff-probes-20260712/`
- Report: `handoff-probe-report.md` / `handoff-probe-summary.json`
- England: switch OK → 6 turns, all GLM-5.2
- Egypt: switch OK → 6 turns, all GLM-5.2

## Route compare

- Request/result: `.coc/playtests/masks-route-compare-20260712/artifacts/` (also copied under Run A/B `artifacts/`)
- Method: `artifact_mediated_semantic` (keyword/string match rejected by tooling)
- Run A-only: scenes `[]`; edges `lima-museum->puno-hub` → `optional`

## Three-axis final (structured evidence)

| Axis | Score | Notes |
|------|------:|-------|
| Rules / structured integrity | **76** | Clean GLM attestation + chapter-switch hashes; −8 formal evidence-export gap; −6 tip `state_health` sanity schema issue on Run B |
| Director / orchestration | **82** | Both runs reach `america-resolution`; nearly identical scene coverage; known social REVEAL stall recovered via `flag_commits` on Run A |
| Prose / GLM immersion | **82** | Stable `glm-5.2` on accepted turns; attestation retries never accepted as fallback |

**Overall mean: 80.0**

## Blocking repairs this Phase 3 track

Committed / in-tree:

- `coc_chapter_switch`: clearer unknown-module error (expects `.coc/module-library` on campaign workspace)
- `trusted-playtest-runners.json`: pin `interactive_driver` sha256 to current `coc_interactive_playtest.py` (was stale → `trusted_runner_registry_mismatch`)

Local `.coc/` (not for git):

- Resume / America overlays / flag_commits used during the live runs
- Phase 3 closure materialization: segment `evidence.json`, route ledgers, three-axis, verification-sample

## Remaining follow-up (not a long-run restart)

1. Persist narrator `secret_audit` into interactive `runner-invocations.jsonl` (or equivalent) so a future blind run can be formally `battle-report.md` eligible without synthesizing receipts.
2. Optional: repair tip `state_health` sanity schema warning observed on Run B public state.

## Artifact index

| Artifact | Path |
|----------|------|
| Run A diagnostic report | `.coc/playtests/masks-peru-america-run-a-20260712/artifacts/diagnostic-play-report.md` |
| Run A freeze receipt | `.coc/playtests/masks-peru-america-run-a-20260712/artifacts/freeze-receipt.json` |
| Run B verification sample | `.coc/playtests/masks-peru-america-run-b-20260712/artifacts/verification-sample.md` |
| Run B freeze receipt | `.coc/playtests/masks-peru-america-run-b-20260712/artifacts/freeze-receipt.json` |
| Three-axis | `.../artifacts/three-axis-eval.md` (+ `.json`) on Run A and Run B |
| Route compare | `.coc/playtests/masks-route-compare-20260712/artifacts/route-comparison.md` |
| Handoff probes | `.coc/playtests/masks-handoff-probes-20260712/handoff-probe-report.md` |
| Closure summary | `.coc/playtests/masks-phase3-closure-20260712.json` |
