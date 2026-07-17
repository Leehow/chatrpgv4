# COC clean-slate persistence and Codex-host evidence

Work ID: `coc-clean-slate-host-evidence`
Status: `In Progress`
Last updated: `2026-07-16`

## Goal

Make the canonical Codex plugin reliably testable with the main Codex as KP
and a collaboration subagent as player, produce an honest complete battle
report, and enforce the project's no-old-save policy as a runtime invariant
rather than a conversational convention.

## Decisions

- A main-Codex-host run and a Pi-host run are distinct topologies even when
  both load `plugins/coc-keeper`.
- Actual-play occurrence, report completeness, and evidence eligibility are
  separate dimensions. Manual identity and shared-filesystem isolation remain
  `NOT_ATTESTED` without a collaboration-service receipt.
- No old campaign, runtime store, pending batch, checkpoint, or compiled cache
  is migrated or dual-read. Delete/restart or recompile on version mismatch.
- Same-current-schema transactional recovery remains allowed.
- Coverage, readiness, report, and recorder logic never become narrative gates.

## Items

| Item | Status | Note |
|---|---|---|
| Correct false Codex-subagent evidence claims | Done | Integrated as `828ce27`; manual relay is diagnostic and ineligible. |
| Record true main-Codex-host turns | Done | Integrated as `aa9f30f`; 3-turn fresh run verified `VALID`. |
| Produce a real complete Codex-host battle report | In Progress | Worker `codex-host-report-bridge-20260716`; must capture authoritative roll sources and keep eligibility false. |
| Establish one clean-slate generation preflight | In Progress | Worker `clean-slate-core-p0-20260716`; reject existing mismatches and expose explicit fresh-generation discard. |
| Remove historical run resume from live gameplay | In Progress | Same P0 worker; historical reports stay read-only. |
| Remove core loader/default compatibility | In Progress | Same P0 worker covers `coc_state` and runtime state gateway first. |
| Remove toolbox persistence compatibility | Not Done | Decision ledger, roll receipts, flags, time markers; preserve current receipt recovery. |
| Remove growth/ending compatibility | Not Done | Legacy ticks, claims, ending adoption/mirrors; preserve current journal recovery. |
| Remove subsystem/SAN/NPC/checkpoint/cache compatibility | Not Done | Add missing exact schemas and fresh-generation behavior. |
| Golden clean-slate and topology regression tests | Not Done | Mismatch deletes/restarts; current interrupted writes recover; exact Codex-host topology remains testable. |
| Resume full-scenario exhaustive playtests | Deferred | Resume after battle-report bridge and P0 clean-slate boundary are validated. |

## Validation evidence

- `.tmp/team-lead/worker-prior-codex-path-recon-20260716.md`
- `.tmp/team-lead/worker-clean-slate-compat-recon-20260716.md`
- `.coc/playtests/codex-host-haunting-20260717T011236Z-recorded/verification.json`
- Integrated focused tests: `136 passed`; plugin metadata: `43 passed`.
- `coc_eval.py run --suite smoke --root .`: `PASS` at `aa9f30f`.

## Blockers

- The current recorder does not capture authoritative roll source logs into
  its run directory, so `coc_eval report` cannot satisfy Dice Completeness.

## Next action

Review and integrate the report bridge, rerun a fresh recorded scenario, then
dispatch the P0 clean-slate preflight/core-loader implementation slice.
