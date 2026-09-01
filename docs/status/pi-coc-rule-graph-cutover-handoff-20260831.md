# Pi-Coc CoC7 RuleGraph cutover handoff — 2026-08-31

## Integration state

- Active track: `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`.
- Integration branch: `codex/pi-coc-all-rule-families-20260831`.
- Base: `0.8.1a` at `60c1c4b4`.
- Integrated code head before this handoff commit: `06f5baaa`.
- DirectorGraph, TextGraph and White War ModuleGraph were intentionally not changed.

## What is complete

The production CoC7 RuleGraph now contains all ten rule families:

- healing
- core-check
- push-luck
- social
- psychology
- combat
- chase
- sanity
- magic
- development

All ten families have source-bound accepted shards, production graph content,
`family_runtime_ownership=graph`, `legacy_surface_lifecycle=hidden`, and package
promotion eligibility. The production artifact at this handoff has 433 nodes
and 665 relations. `rules.context` and `rules.settle` are the normal Pi-Coc
Keeper surface; legacy family-specific operations remain host-only.

The following integration defects found by real RPC play were repaired:

- live handler lookup and frozen result serialization;
- Social-to-Core derived stakes without exposing a Core-only model field;
- Push actor routing and cross-investigator continuation isolation;
- Social settled-result semantic projection and Social-failure-to-Push runtime
  continuation;
- Development end-session settled-result projection;
- normal Pi play uses one final draft and typed finalization without repeated
  narration review;
- `pi-coc` now selects the repository-bundled patched Pi 0.84.2 instead of a
  stale PATH/global Pi 0.84.0;
- patched agent-loop replan was verified to execute only `refresh_graph` and
  defer stale sibling tool calls.

## Gate 9 evidence status

Gate 9 means a fresh normal production-profile `pi-coc --mode rpc` run with
direct xAI `grok-4.5` as Keeper, no acceptance profile, fixture, seed, injected
family trigger, reduced tool surface or legacy family operation.

| Family | Status | Evidence / reason |
| --- | --- | --- |
| Development | **PASS** | Fresh D2 naturally refused the commission; `rules.context(development)` -> `decision:coc7:development:end-session` -> settled/PASS -> one public Luck D100 -> journal/output-context/finalize -> visible ending. `/Users/haoli/Documents/TRPG/pi-coc-gate9-ten-family-38a3a4af/d2-development/evidence/turn-p-23b2d9ba3c6c.json` |
| Social | **PASS** | Fresh A10 naturally negotiated terms; production Social decision settled, public Persuade 80 vs 40 rendered, failure consequence and final text delivered. `/Users/haoli/Documents/TRPG/pi-coc-gate9-ten-family-06f5baaa/a10-social-push/evidence/turn-p-b651aa2b3e41.json` |
| Push/Luck | **FAIL — projection only** | The A10 pushed-roll canonical settlement committed exactly once, but model view failed on `bound_check.npc_id`, `social_adjudication_ref`, and `original_check.integrity_digest`; later retries correctly reported already pushed. `/Users/haoli/Documents/TRPG/pi-coc-gate9-ten-family-06f5baaa/a10-social-push/evidence/turn-p-1d0e467bcdb6.json` |
| Core-check | **needs current-runtime replay** | Earlier natural pass predates the corrected bundled-Pi launcher, so it is not final current-head Gate 9 evidence. |
| Psychology | **needs current-runtime replay** | Earlier natural pass predates the corrected bundled-Pi launcher. |
| Healing | **UNTESTED** | R2 natural play reached the upstairs house but not a natural injury/healing opportunity before quota closeout. |
| Combat | **UNTESTED** | R2 did not naturally reach a combat exchange before closeout. |
| Sanity | **UNTESTED** | R2 did not naturally reach a SAN trigger before closeout. |
| Chase | **UNTESTED** | R2 did not naturally reach a pursuit before closeout. |
| Magic | **UNTESTED** | R2 stopped before a legitimate person/tome/spell source was reached. |

R2 evidence roots were preserved:

- `/Users/haoli/Documents/TRPG/pi-coc-gate9-hcs-r2-38a3a4af`
- `/Users/haoli/Documents/TRPG/pi-coc-gate9-chase-magic-r2-38a3a4af`

All task-owned RPC daemons were stopped before handoff. No campaign or evidence
directory was deleted.

## Deterministic validation already obtained

Before the final quota-safe closeout, the integrated lanes reported and the
lead spot-checked:

- production/source/Ontology/package groups: 90 passed, 13 skipped;
- rules runtime/subsystem group: 244 passed;
- policy/metadata/audit/conformance group: 76 passed;
- combined Node group: 123 passed;
- Social projection focused test: passed;
- Social failure -> actor-bound graph Push regression: passed;
- Development first/replay projection and unknown-identity negative: passed;
- normal production direct-single-draft Python and Node tests: passed;
- launcher selection tests: 6 passed;
- patched agent-loop replan probe: `executions=[refresh_graph]`.

These results are component/integration evidence, not substitutes for the
missing family Gate 9 rows above.

## Known remaining work

1. Implement a closed Push/Luck `pushed-roll` `rules.settle` projector. Reuse
   the family-aware embedded-result dispatcher; preserve the pushed D100 and
   visible consequence, hide Social correlation/original receipt integrity,
   and never rerun mechanics. The exact three failing paths are recorded in
   the Gate 9 table above; the temporary worker worktree was safely closed.
2. Fix `tests/pi/normal-model-id-boundary.mjs`: 22 current failures are the
   typed and generic copies of eleven unclassified
   `rules.settle.semantic_inputs.*_ref(s)` fields: actor/opponent checks,
   combined targets, commitment, location, pursuer/quarry, target, trigger,
   weapon/effect references. Add exact semantic domains; do not broadly allow
   arbitrary `*_ref` strings.
3. Add the explicit production RuleGraph Social -> Push `continues-as` relation.
   Runtime continuation parity works through the canonical failed-check grant,
   but the source graph/Ontology currently has no explicit edge.
4. Re-run current-head Gate 9 for Push/Luck after its projector, then Core,
   Psychology, Healing, Combat, Sanity, Chase and Magic. Keep one narrow player
   action per turn and retain all evidence.
5. Test `decision:coc7:development:settle-ending`; only `end-session` has current
   production projection and Gate 9 proof.
6. Update stale documentation: `docs/specs/pi-coc-rule-graph-runtime.md`,
   `docs/ruleset-contract.md`, ADR 0003 and `docs/status/CURRENT.md`. ADR 0003
   still describes the original healing-only slice and absent Director/Text
   production artifacts; the latter absence remains true, the healing-only
   statement does not.
7. Re-run the final deterministic groups after the remaining projector and ID
   classification fixes. Do not claim whole-goal completion before every Gate
   9 row is PASS.

## Operational notes

- Run `npm ci` in `runtime/adapters/keeper` in every fresh worktree before Pi
  agent-loop tests; `patch-package` must report all three 0.84.2 patches applied.
- `pi-coc` now fails closed if the bundled Pi install is missing, mismatched or
  unexecutable. A global Pi is not a substitute.
- Direct xAI showed occasional `invalid_grant`, generation-error and 180-second
  provider stalls. Keep these separate from deterministic family failures.
- Credential hygiene: one earlier diagnostic tool output printed xAI OAuth
  token fields before redaction. No credential was committed, but rotating the
  xAI OAuth credential is recommended.

## Closeout

The quota-closeout verifier and partial-fix worktrees were safely closed after
their evidence was summarized above. Implementation branches whose commits
were cherry-picked remain retained because their original commits are not
ancestors of `0.8.1a`; lifecycle closeout correctly refused to delete them as
unique history. Do not force-delete those retained branches.
