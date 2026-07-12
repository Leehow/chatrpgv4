# Masks Whitebox Playtest — Status

Updated: 2026-07-12 (Run B2 eligible battle-report landed; historical Run B remains verification-sample)

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
| 2 | GLM canary | **Pass** — Run A canary + Run B2 `canary-result.json` (`ok=true`, `zhipu-coding/glm-5.2`, `deterministic_fallback=false`, `secret_audit` persisted) |
| 3 | Run A Peru+America | **Pass** — aggregate **99** turns; Peru tip `primary-run/checkpoints/turn-000038` @ `peru-resolution` → chapter switch → America tip `america-continuation/checkpoints/turn-000061` @ `america-resolution` |
| 4 | Run B blind | **Pass** — historical `masks-peru-america-run-b-20260712` (80 turns, verification-sample) **and** fresh `masks-peru-america-run-b2-20260712` (80 turns, eligible battle-report) |
| 5 | Route compare | **Pass** — structured ledgers + artifact-mediated semantic result; A-only edge `lima-museum->puno-hub` classified `optional` (B used `lima-museum->travel-to-puno->puno-hub`) |
| 6 | England/Egypt probes | **Pass** — 6 GLM turns each; entries `england-arrival` / `egypt-arrival`; 0 attestation failures |
| 7 | Blocking fixes + regression | **Pass** — flag/move/resume/chapter-switch/registry pin; secret_audit persistence (`fa46c3d`); focused tests green |
| 8 | Three-axis scores | **Pass** — final scores below (structured evidence only; scored on Phase 3 closure set) |
| 9 | Tests | Focused evidence/route/chapter/metadata green after registry pin |
| 10 | Evidence naming | **Pass** — Run A → `diagnostic-play-report.md` only. Historical Run B → `verification-sample.md`. **Run B2 → `battle-report.md`** (`formal_battle_report_eligible=true`) |
| 11 | No copyrighted prose in git | **Pass** |

**Run B2 battle-report eligibility:** **Eligible** (`formal_battle_report_eligible=true`). Peru 38/38 + America 42/42 narrator `secret_audit` receipts persisted in `runner-invocations.jsonl`, KP `zhipu-coding/glm-5.2` only, no deterministic fallback on accepted turns. Historical Run B remains ineligible verification-sample (secret_audit inputs not recoverable).

## Run A (frozen diagnostic)

- Path: `.coc/playtests/masks-peru-america-run-a-20260712/`
- Report: `artifacts/diagnostic-play-report.md` + `artifacts/freeze-receipt.json` + `artifacts/evidence-summary.json`
- Peru tip: `primary-run/checkpoints/turn-000038` @ `peru-resolution`
- America tip: `america-continuation/checkpoints/turn-000061` @ `america-resolution`
- KP on all accepted turns: `zhipu-coding/glm-5.2`, `deterministic_fallback=false`
- Chapter switch: verified (`chapter-switch-result.json`)

## Run B (historical blind; verification-sample only)

- Path: `.coc/playtests/masks-peru-america-run-b-20260712/`
- Seed: `masks-run-b-20260712`; campaign/investigator remapped; no GPT player
- Tips: Peru `primary-run/checkpoints/turn-000038` @ `peru-resolution`; America `america-continuation/checkpoints/turn-000042` @ `america-resolution`
- Harness: `total_turns=80`, `chapter=america-complete`, `blocker=null`
- Report: `artifacts/verification-sample.md` + `artifacts/freeze-receipt.json` + `artifacts/evidence-summary.json`
- Formal eligible: **false** (`narrator_secret_audit_invalid`; secret_audit not recoverable for backfill)
- Recovery probe: `artifacts/secret-audit-recovery.json`

## Run B2 (fresh blind; eligible battle-report)

- Path: `.coc/playtests/masks-peru-america-run-b2-20260712/`
- Seed: `masks-run-b2-20260712`; campaign `masks-run-b2` / investigator `masks-run-b2-inv`; isolated sandbox; no GPT player
- Driver: `coc-interactive-playtest@1` sha256 `293b60de5e96c263712c4498a3153629105f7c67bb1f3a150db30b1f1b5d338c` (post-`fa46c3d`)
- Canary: `canary-result.json` (`ok=true`, `secret_audit_passed=true`)
- Tips: Peru `primary-run/checkpoints/turn-000038` @ `peru-resolution`; America `america-continuation/checkpoints/turn-000042` @ `america-resolution`
- Harness: `total_turns=80`, `chapter=america-complete`, `blocker=null`
- Attestation: Peru 38 + America 42 all `zhipu-coding/glm-5.2`, `deterministic_fallback=false`, secret_audit passed 38/38 + 42/42
- Report: `artifacts/battle-report.md` + `artifacts/freeze-receipt.json` + `artifacts/evidence-summary.json`
- Formal eligible: **true**

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
| Rules / structured integrity | **76** | Clean GLM attestation + chapter-switch hashes; historical Run B formal evidence-export gap closed by B2; −6 tip `state_health` sanity schema issue on historical Run B |
| Director / orchestration | **82** | Runs reach `america-resolution`; nearly identical scene coverage; known social REVEAL stall recovered via `flag_commits` on Run A |
| Prose / GLM immersion | **82** | Stable `glm-5.2` on accepted turns; attestation retries never accepted as fallback |

**Overall mean: 80.0**

## Blocking repairs this Phase 3 track

Committed / in-tree:

- `coc_chapter_switch`: clearer unknown-module error (expects `.coc/module-library` on campaign workspace)
- `trusted-playtest-runners.json`: pin `interactive_driver` sha256 to current `coc_interactive_playtest.py`
- `fa46c3d`: persist narrator `secret_audit` into interactive `runner-invocations.jsonl` (+ session `narrator-secret-audits.jsonl`)

Local `.coc/` (not for git):

- Resume / America overlays / flag_commits used during the live runs
- Phase 3 closure materialization: segment `evidence.json`, route ledgers, three-axis, verification-sample
- Run B2 sandbox + eligible `battle-report.md`

## Remaining follow-up (not a long-run restart)

1. ~~Persist narrator `secret_audit` into interactive `runner-invocations.jsonl`~~ **Done**
2. ~~Fresh blind run with fixed driver → eligible `battle-report.md`~~ **Done** (`masks-peru-america-run-b2-20260712`)
3. Historical Run B gap remains intentionally frozen as verification-sample (no receipt synthesis / no 80-turn replay)
4. Optional: repair tip `state_health` sanity schema warning observed on historical Run B public state

## Artifact index

| Artifact | Path |
|----------|------|
| Run A diagnostic report | `.coc/playtests/masks-peru-america-run-a-20260712/artifacts/diagnostic-play-report.md` |
| Run A freeze receipt | `.coc/playtests/masks-peru-america-run-a-20260712/artifacts/freeze-receipt.json` |
| Run B verification sample | `.coc/playtests/masks-peru-america-run-b-20260712/artifacts/verification-sample.md` |
| Run B freeze receipt | `.coc/playtests/masks-peru-america-run-b-20260712/artifacts/freeze-receipt.json` |
| **Run B2 battle report** | `.coc/playtests/masks-peru-america-run-b2-20260712/artifacts/battle-report.md` |
| Run B2 freeze receipt | `.coc/playtests/masks-peru-america-run-b2-20260712/artifacts/freeze-receipt.json` |
| Run B2 evidence summary | `.coc/playtests/masks-peru-america-run-b2-20260712/artifacts/evidence-summary.json` |
| Three-axis | `.../artifacts/three-axis-eval.md` (+ `.json`) on Run A and Run B |
| Route compare | `.coc/playtests/masks-route-compare-20260712/artifacts/route-comparison.md` |
| Handoff probes | `.coc/playtests/masks-handoff-probes-20260712/handoff-probe-report.md` |
| Closure summary | `.coc/playtests/masks-phase3-closure-20260712.json` |
