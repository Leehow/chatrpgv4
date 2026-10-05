# Source dagger identity: isolated repair and acceptance

Owner: original Claude creature-kind session `50b4147c-41e8-4152-800e-95ba979b29f8`; owned branch
`codex/creature-kind-acceptance-20261005`, base `f8b17df89d35cf40c95018248ba62ce674dadfeb`.
Authorization: owner relay `Sentinel_8175e295276c819188cdc03a377a1cee` (2026-10-05), dagger repair plus
zero-model regression and actual deterministic CLI proof. Integration belongs to the sole coordinator.

## Problem and resulting behavior

An accepted usage projects an instance-bound `usage-*` weapon id. The authored Haunting encounter compared only
`corbitt-ritual-dagger`, so an actual held source dagger using the accepted usage took `conventional-assault`.
An explicit first `apply object.source_object` now resolves the source handle to `{module_id,node_id}` on the
physical instance. Transfers and weapon projections retain it. The selector matches that same-module source
object's existing `runtime_rule_ref` to the encounter's `on_success.rule_ref`; names never establish identity.
Existing unmanaged canonical weapon ids retain their exact matching path. Definitions and usage parameters
remain immutable, and existing instances receive no inferred binding or automatic migration.

Every investigator attack reselects for its current weapon and actual target. Preparations still run only when
the fight opens. Pending defence checks ownership, physical basis and source identity. The existing ordinary
combat executor executes the authored terminal effect only on a successful hit. The Haunting graph adds only
`investigator_usage_mode: melee`; its two guidance graph digests follow the new graph bytes.

Source check: the shipped PDF window's physical page 15 / printed page 449 says wrest control of Corbitt's floating
dagger and successfully stab him with it, then ash/dust regardless of spells. The existing physical means and
authored effect remain the authority. Sunlight is still conditional Keeper discretion. This change introduces
no immunity parser, damage multiplier, name classifier, Boss class or new effect engine. Acquiring the object
continues through ordinary committed ownership/check calls; this repair does not assert a contested pickup
succeeded or make source knowledge into a discovered player clue.

## Actual verification

Evidence root: `/Users/haoli/Documents/Codex/2026-10-04/task-7/evidence/dagger-source-identity-20261005/`.
Commands use the App's Node 24 executable for the installed `fs-ext` ABI, isolated engineering workspaces and
controlled accepted Mod artifacts. No model/provider calls, user campaign writes, App writes or full suite runs.

| Check | Actual result |
| --- | --- |
| `source-weapon-identity`, `object-usages`, `object-usages-rpc`, `haunting-shapes`, `clue-summary-is-keeper-only` | 36/36, exit0, `targeted-regression-final.log` |
| Selected existing `executeCombatResolve declares then defends` receipt regression | 1/1, exit0, `ordinary-terminal-regression.log` |
| `tsc -p tsconfig.kernel.json` | exit0, `typecheck-final.log` |
| Actual old CLI RPC, archived base kernel/runtime source | exit0 confirming reproduced failure, `cli-baseline-2/summary.json` |
| Actual candidate CLI RPC, final source | exit0 confirming terminal effect, `cli-candidate-final/summary.json` |

The CLI script `scripts/check-source-weapon-identity.mjs SOURCE_ROOT NEW_EVIDENCE_DIR baseline|candidate`
builds an isolated diagnostic RPC bundle and refuses to overwrite an existing evidence directory. It preserves
all requests/responses, diagnostics, accepted packets, campaign state, runtime hash and actual receipt objects.
Both successful comparisons use the same content, fixed RNG seed, physical item name, accepted definition,
usage profile, source handle, scene route and attack. Their generated weapon id is identical:
`usage-5de245411219ed65c4a96cf4`.

- Base: no retained source identity; `conventional-assault`; no exception; actual attack rolled;
  Corbitt HP 16, no dead condition, combat active.
- Candidate: identity retained; `strike-with-his-dagger`; `own_dagger_ignores_spells`; actual attack rolled;
  HP 16→15→0, `dead` condition and `combat end / investigators_win` receipts.

The regressions also execute a historical unmanaged canonical weapon, an unbound same-name dagger, a thrown
source dagger, another target, another holder, a miss, a change from ordinary combat to the source dagger, and
a pending attack whose object was transferred away. Wrong means/mode/target/holder, miss and stale usage cannot
execute the special effect. Duplicate source copies, nonphysical/source-alias handles, stacked quantity and
retroactive rebinding fail atomically. Raw initial failed fixture/build attempts remain in the evidence root;
they are not cited as successful execution.

## Limits and handoff

This candidate proves the deterministic use path. Natural model use remains `not_observed`; the original ten
turns are preserved and the additional four turns remain unapproved. The final installed package still needs
coordinator integration, artifact identity verification and affected acceptance. Shared mainline WIP and App
were not modified. The separate PDF source-fact ingestion investigation is not included in this repair commit.
