# Pi-Coc system regressions and repository health

Work ID: `pi-coc-system-regressions-20260822`
Status: `In Progress`
Last updated: `2026-08-22`

## Goal

Implement the approved remediation in
`docs/specs/pi-coc-system-regressions-and-repository-health.md`:
restore cash and handout product paths, remove fabricated weapon mechanics,
make narration language and static-file confinement truthful, protect local
evidence from accidental staging, then deepen the two major hotspots by
logical ownership rather than line count and inventory repository lifecycle
debt without destructive cleanup.

## Authorization and track

- `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`.
- The user's approval covers the Pi-Coc and exact shared files named by the
  approved spec, plus scoped local commits and integration.
- R3 now requires two additional exact shared language sources that the spec
  did not name: `plugins/coc-keeper/scripts/coc_language.py` and
  `plugins/coc-keeper/scripts/default_localized_terms.json`. They remain
  unmodified pending explicit user authorization.
- Codex-host implementation remains off-limits.
- No push, deploy, evidence deletion, pre-existing worktree/branch deletion,
  or destructive Git is authorized.
- Existing campaigns, logs, transcripts, artifacts, module assets, and
  unrelated worktrees are preserved.

## Source of truth

- Spec:
  `docs/specs/pi-coc-system-regressions-and-repository-health.md`
- Accepted base at intake: `79b011d5b227`
- Validation levels and acceptance IDs: spec sections 6 and 7.

## Work graph

| Workstream | Status | Owner/lane | Dependency | Notes |
| --- | --- | --- | --- | --- |
| R0 baseline and ownership freeze | Done | lead | none | Focused reds reproduced; concurrent whole-suite run exited. |
| R1 cash operation parity | Done | registry-handout-language | R0 | Integrated; 124-operation deep policy/archive/surface parity. |
| R2 handout vertical restoration | Done (deterministic) | registry-handout-language | R0 | Integrated; secrecy, session/SSE/materials/HTTP seams green; V3/V4 pending. |
| R3 authoritative weapon projection | Partial | weapon-authority-ui | R0 | A7/A8 green in terminal lane; A9 and player-language chrome need two shared files before integration. |
| R4 narration language truth | Done | registry-handout-language | R0 | Integrated; en-US/ja-JP truthful and non-Chinese guard unavailable. |
| R5 static-file confinement | Done | static-hygiene | R0 | Integrated; encoded/absolute/sibling/symlink probes green. |
| R6 repository ignore/staging hygiene | Done | static-hygiene | R0 | Integrated; committed-range CI and local staged guard green. |
| First-wave review and integration | In Progress | lead | R1-R6 | R1/R2/R4/R5/R6 accepted; R3 retained pending exact shared-file authority. |
| R7 Python logical-unit deepening | Not Done | later worker | R1-R6 green | No line-count target; disjoint agent ownership is the goal. |
| R7 TypeScript logical-unit deepening | Not Done | later worker | R1-R6 green | Preserve the Pi extension interface. |
| R8 lifecycle inventory | Done | lifecycle-inventory | first wave | Dated 41-worktree snapshot integrated; all uncertain targets retained. |
| Deterministic/full validation | Partial | lead + later verifier lanes | integration | Integrated Node 375/375, Python 106/106, Pi Node 36/36; final aggregate waits on R3/R7. |
| Real Pi-Coc/Web acceptance | Not Done | lead | integrated deterministic green | Fresh campaign; preserve evidence. |
| Lifecycle closeout | In Progress | lead | terminal lanes | static/registry/inventory closed; weapon terminal retained; integration active. |

## First-wave lane ownership

### registry-handout-language

Owns canonical toolbox/policy/archive, handout-related skills and tests,
Pi policy/typed contract surfaces, Web handout server/projection tests, and
the narration language contract. It must not edit weapon projection/UI,
`.gitignore`, static-path serving outside handout routes, or hotspot refactors.

### weapon-authority-ui

Owns `runtime/sdk/weapon_display.py`, its direct projection caller/tests, and
the minimum player-facing Items UI/type/tests required to show unresolved
mechanics. It must not edit canonical toolbox/policy/archive, handout paths,
static serving, ignore rules, or hotspot refactors.

### static-hygiene

Owns static-file confinement and tests, root `.gitignore`, and a minimal
read-only staging guard plus tests/docs if justified. It must not edit toolbox,
Pi policy, handouts, weapon projection/UI, or perform any cleanup.

## Stop conditions

- overlapping ownership or unknown concurrent editor;
- opposite-track or newly required shared scope outside the approved spec;
- destructive cleanup, push, deploy, secret/auth work, or irreversible data;
- proposed weapon semantics from labels/keywords;
- proposed non-Chinese semantic keyword guards;
- evidence deletion or worktree/branch removal;
- ambiguous validation caused by shared-checkout concurrency.

## Validation ledger

| Acceptance | Status | Current evidence / remaining gate |
| --- | --- | --- |
| A1 | Done | All 124 policy objects, archive objects, exact surface buckets, and typed membership deep-equal canonical toolbox policy. |
| A2 | Done (deterministic) | Cash operations pass live-turn Pi ACL/domain/typed tests; V3 real turn still needed for product evidence. |
| A3 | Partial | Cash mutation/finalization projection green; real Pi-Coc visible receipt pending. |
| A4 | Done | Valid handout delivery is discoverable/idempotent; malformed/unknown cards fail closed. |
| A5 | Partial | Materials refresh and per-session SSE exactly-once/retry green; canonical browser refresh pending. |
| A6 | Done | Real HTTP route rejects undelivered, hidden, malformed, and unauthorized asset reads. |
| A7 | Done in weapon lane | Five true unknown labels have no fabricated mechanics. |
| A8 | Done in weapon lane | Exact ruleset and active source-authored module IDs preserve mechanics. |
| A9 | Blocked on authority | Backend/UI plumbing exists, but canonical unresolved/range/ammo chrome needs the two named shared language files. |
| A10 | Done | en-US and ja-JP narration contracts use campaign language. |
| A11 | Done | Non-Chinese contracts report deterministic guard unavailable. |
| A12 | Done | Encoded traversal, sibling prefix, absolute/network path, and symlink escape return 403. |
| A13 | Done | In-root assets, SPA fallback, and API 404 behavior preserved. |
| A14 | Done | Five root ignore rules plus staged/committed-range guard validated. |
| A15 | Done (non-destructive) | Tracked evidence remained present; no tracked evidence deletion. |
| A16 | Not Done | Logical-unit deepening starts only after R1-R6 are green. |
| A17 | Done (snapshot) | Dated exhaustive inventory committed; no unowned target deleted. |
