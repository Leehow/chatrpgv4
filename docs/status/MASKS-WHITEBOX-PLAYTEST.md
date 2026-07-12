# Masks Whitebox Playtest — Status

Updated: 2026-07-12 (Phase 3 in progress)

## Model attestation policy (hard)

| Role | Required identity | Notes |
|------|-------------------|--------|
| KP / Narrator | `zhipu-coding` / `glm-5.2` only | No silent stronger substitute; attestation failure → replay, never continue on fallback as a valid turn |
| Player | Human / this agent via JSONL | `runtime.player.kind = human`; **no GPT / OpenAI / Codex player lane** |
| Evaluators | Non-GPT preferred | Structured rules audit + local evidence |

Canary (prep): both sandboxes attested `{"provider":"zhipu-coding","id":"glm-5.2"}`, `deterministic_fallback=false`.

## Acceptance criteria 1–11

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Packages/gates | **Pass** |
| 2 | GLM canary | **Pass** |
| 3 | Run A Peru+America (or legitimate terminal/blocker before 500) | **In progress** — durable tip **turn 20** @ `puno-hub` after museum→Puno unlock fix; target 120–220 |
| 4 | Run B blind | **Not started** |
| 5 | Route compare | **Not started** |
| 6 | England/Egypt probes | Infra smoke only; live probes **not done** |
| 7 | Blocking fixes with regression | **Partial → advancing** — investigator-state seed; **flag_set commit on structured move**; invalidated resume across code revisions |
| 8 | Three-axis scores | **Not started** |
| 9 | Full tests | Focused suites green; plugin metadata 49 passed |
| 10 | Evidence naming | Diagnostic artifacts only so far |
| 11 | No copyrighted prose in git | **Pass** |

**Run B battle-report eligibility:** not evaluated (Run B not started).

## Run A durable tip

- Path: `.coc/playtests/masks-peru-america-run-a-20260712/primary-run/`
- Checkpoint: `checkpoints/turn-000020`
- Scene: `puno-hub` (Peru); chapter switch **not** yet
- Latest accepted model: `zhipu-coding/glm-5.2`, `deterministic_fallback=false`
- Invalidated: turns 21–33 museum stall (pre-flag fix narration-only travel); recovered tip after `turn_persistence_failed` caused by leftover contaminated checkpoints `turn-000020`–`033`

## Engine fixes committed this session

- `367844c` — `fix(director): commit flag_set gates on structured move`
- `e617ca5` — `fix(playtest): allow invalidated resume across code revisions`

## Next

1. Continue Run A from `turn-000020` through Peru terminal → America → America resolution (batches; attest replay on P1).
2. Freeze Run A → context-isolated Run B (self as blind player, no GPT).
3. England/Egypt handoff probes; three-axis eval; reports (`diagnostic-play-report.md` / `battle-report.md` only if eligible).
