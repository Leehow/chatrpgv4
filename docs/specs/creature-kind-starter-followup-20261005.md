# Creature starter binding follow-up — 2026-10-05

Status: ready-for-human — narrow source candidate for the coordinator; not installed or naturally verified.

This continues the original Claude creature-kind task (`50b4147c-41e8-4152-800e-95ba979b29f8`). The independent
`codex/creature-kind-acceptance-20261005` branch was clean and fast-forwarded to accepted mainline
`5716e6d93a291861dddfa724a2c0c5c6043db2f5` before this repair. Original worktrees and concurrent mainline WIP are preserved.
The coordinator retains the sole integration/package queue; this owner changed neither mainline nor the App.

## Current product ruling

The user explicitly accepts turn 10's abstract combat actor being `dead: true` while the prose says one rat died
and the rest fled (message `Sentinel_13a0b24bd6e48191ac50d078b4a3c771`, relayed by parent thread
`01a104b9-96e3-7401-b529-ee16ec848014`). That event is no longer a product failure. This candidate adds no death
restriction, compulsory `away`, member counter, combat-engine change or Mod version change. All such tentative
changes from this turn were withdrawn before delivery. Tools and Hostile Creatures remain byte-identical to the base.

Habit/weakness supply is a separate, confirmed missing projection. Actual use of the weakness remains unobserved.
The original ten inputs are all charged to the ten-turn limit. Four additional turns remain unapproved; this repair,
diagnostic and all regressions make zero model requests.

## Why the earlier runtime report was too strong

- The 04:11 preflight checked HEAD and equality between the shared source build and its copied build. It did not
  establish build freshness against an independent reviewed package artifact. Both copies were stale: RPC hash
  `806b924d…` rather than b79's `e5fcb82f…`; launch/hybrid hashes also differed. The wrapper itself was identical.
- The partial archive omitted top-level `mods/`. Adding those files did not supply capabilities absent from the old
  RPC (`actor.weaknesses.v1`, `instructions.sections.v1`, `checks.presence.v1`). Expected locks were recorded without
  checking the campaign's actual locks before the first model input. This was this owner's verification mistake.
- Global turns 1–4 therefore do not satisfy requested runtime/Mod acceptance, although their observed model was Luna.
  Global turn 5 onward used the actual b79 CLI and the three correctly configured locks. The later six turns are a
  continuation retaining the earlier history, not a clean b79-from-start table.
- A further prerequisite was never fixed: the module registered at 04:12 has no vocabulary. Turns 8–10 carry only
  `kind: creature` and `what` for the rat pack, with `habits.bound: false`. Enabling Mods does not rewrite module
  provenance. The unchanged-digest branch of `registerStarter` skipped vocabulary derivation. Weakness projection
  was also absent, independently confirmed by the new read-only preflight on an isolated copy.

The frozen evidence directory `task-7/evidence/haunting-cli-b79-luna/` is unchanged. Its older reports retain the
earlier failure classification as historical evidence; the product ruling above supersedes that classification.

## Repair and boundaries

Contract §180.18 precedes the implementation. On re-registering an unchanged `source: "starter"`, the existing
registry lock and published-graph integrity check protect the stored cohort. `starterVocabulary` derives candidates
from the verified source data and installed compatible packages. The merge adds only unclaimed keys and an absent
weakness binding. Existing labels, versions, package claims, cross-spine keys, explicit values and unrelated metadata
remain. The existing being checker runs before a changed binding is published.

The repair does not write graph bytes, mint a generation or change campaign state/history. Edited graph bytes and
malformed old binding metadata refuse. A malformed source weakness refuses before publication. A user/PDF provenance
is not inferred; unavailable contributions remain unbound and cannot pass the acceptance gate.

`scripts/creature-acceptance-preflight.mjs` requires an independently reviewed expected commit, receipt digest,
four compiled/wrapper hashes, exact three Mod locks and authored habit/weakness facts. It checks the actual resource
root against the receipt and refuses before kernel reads on identity mismatch. It then reads actual locks and four
read RPCs (`mods.list`, `table.capsule`, two actor cards). Pending settings, missing bindings or missing projected facts
refuse. It configures nothing, opens no turn and starts no Pi/provider. A pass is only prerequisite verification.

Example invocation (the expectation must be supplied by the reviewed package queue, not generated from the runtime
under test):

```
node scripts/creature-acceptance-preflight.mjs --root <actual-resource-root> --home <isolated-home> \
  --campaign <existing-id> --receipt <reviewed-receipt> --expected <trusted-expectation.json>
```

The expectation's fields are `commit`, `receipt_sha256`, `files` (the four paths exported as `REQUIRED_FILES`),
`mod_locks` and `requirements: {creature, habits, weakness_actor, weakness_books}`. File hashing uses the existing
SHA-256 approach ([Node Hash API](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options)); no dependency
or alternate migration framework was added.

## Zero-model evidence

Evidence root: `/Users/haoli/Documents/Codex/2026-10-04/task-7/evidence/creature-followup-20261005/`.

| Check | Result | Evidence |
| --- | --- | --- |
| Kernel TypeScript check | exit 0 | `tsc -p tsconfig.kernel.json`; tool session 55552 |
| Final five related Node files, serial | 54/54, exit 0 | `final-related.log` |
| Prerequisite mechanisms | 6/6, exit 0 | `preflight-mechanisms.log` |
| Actual b79 read-only gate on old-table copy | expected exit 1; only three binding checks fail | `old-campaign-preflight.json` |
| Patched-source RPC `module.register` on that copy | exit 0; vocabulary restored | `repair-1.json`, `source-repair.json` |
| Existing b79 kernel reads repaired copy | 19/19 prerequisites, exit 0, empty stderr | `repaired-copy-preflight.json` |
| Preservation | original 444 files unchanged; copied graph/generation and 47 campaign files unchanged | `original-evidence-preserved.json`, `source-repair.json` |

Regressions cover unchanged-digest legacy registration, idempotence, existing binding preservation, edited/user graph
protection, unavailable contribution, malformed vocabulary/weakness failure and the actual capsule/card projection.
The gate rejects two identical stale builds despite the correct commit, incomplete expectations, altered receipts,
missing/wrong/settings-mismatched locks, pending configuration, unbound habits, missing facts and failed reads.

The isolated RPC bundle is a diagnostic of candidate source, not a newly installed patched App. Its content was the
existing App's source/Mods; only the copied module metadata was repaired through the normal product method. The old
model ledger, rat `dead` value and all turn records remain intact. No full suite, runtime packaging or model test ran.

The earlier `starter-and-actor.log` is retained as an intermediate check before the user's ruling; it includes the
withdrawn one-member/away test and the tentative Mod version, so it is not the final candidate's test certificate.
Use the final logs above. Integration/package verification and bounded natural weakness use remain open.
