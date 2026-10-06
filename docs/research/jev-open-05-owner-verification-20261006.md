# JEV-OPEN-05 owner verification of the merged feature

Owner: `01a10ef5-dece-76c3-90fd-6bea904c4003`.
Date: 2026-10-06.
Pinned merged source: `b91cd53a4dbdd38e67f74dd5b58d7b1bf7258c54`.
Follow-up branch: `codex/jev-open-05-acceptance-20261006` in the original task worktree.

The user's corrected boundary is that the original owner completes verification
of their own changed functions. Existing targeted evidence remains valid; neither
a broad natural playtest nor acceptance of unrelated functions is required to
finish this narrow task. The owner has not transferred this responsibility to
JEV-OPEN-06/07, and no other task's model allowance was used.

## Merged implementation and reused evidence

`918da6d211ac47af6c511e94def3ab2cac26f4a6` is an ancestor of the pinned source.
Its integration is recorded as `c6141ae375bebaf95b95a3db8f7958815c5e690a`.
Comparison of the four production files and three regression files confirms
that the retained-action fixes and their tests are still present. The only
later differences in those production files are the declared-time additions
in other regions of hybrid-engine and step-policy; NPC readiness, writer
ownership, roster expiry and the sole-NPC pursuit binding remain unchanged.

The owner's 24 focused continuation/expiry tests and the independent merged
114/114 test result remain evidence. The independent result and exact source
review are at
`/Users/haoli/Documents/Codex/2026-10-04/task-2/jev-review-20261006/05-review.json`
and `05-target-final.log`. These tests were not repeated merely to increase
counts. See `jev-open-05-readiness-20261006.md` for the original commands and
red/green evidence, which remain intact.

## One missing seam executed on the pinned source

The prior negative-body-Build snapshot refusal has already been repaired by
`ad14b240cf0e2d92df5cdd133fa03cda188a2efb`; the owner did not reimplement it.
The earlier signed-Build gateway test started with ready participants. The
small remaining seam was the owner's retained vehicle preparation followed
by ordinary-adult passenger completion producing negative Build.

Added one regression in `tests/extension/chase-readiness-continuation.test.mjs`.
It uses the current TS kernel, actual catalog and selector, held policy action,
apply npc completion, host dispatch, starter receipts and persisted chase state.
Legal lower-bound archetype draws exercise Build -1 through the canonical
completion writer, as the existing signed-Build gateway fixture does; no world
statistics are patched. It verifies no starter before readiness, deep equality
of the original action on release, no new semantic binding, one scheduled
execution, one chase-start receipt, Build/Build_max -1, the original driver link,
zero passenger movement actions, and no replay after execution.

Command (Node v24.19.0, the existing bundled interpreter):

```sh
/Applications/PipiCOC.app/Contents/Resources/pi-coc/node/bin/node --test --test-name-pattern='JEV-OPEN-05: a prepared negative-Build passenger' tests/extension/chase-readiness-continuation.test.mjs
```

Result: **1/1 pass, exit 0**, on the pinned merged source. Log:
`.tmp/jev-open-05/owner-merged-passenger-canonical.log`.
Two preliminary fixture assertions guessed a walk-on handle and read full
profile data from a summarized apply response. Those local fixture failures
are preserved in `owner-merged-passenger.log` and
`owner-merged-passenger-final.log`; they are not current product defects or
acceptance results. The final assertions read canonical saved participants.

## Outcome

The changed retained-action feature is verified within the requested scope.
No new production defect was found, and the follow-up candidate changes only
this test and this report. The original owner remains responsible for failures
of these functions after coordinator integration of the supplemental regression.
The coordinator retains serial review/merge responsibility.

Paid calls made: zero. Additional paid allowance required for this verification:
zero; no available task-specific approved allowance was identified. Natural
model judgement, installed App behavior and unobserved historical families are
not claimed as tested and are not dependencies of this completed scoped feature
verification. No broad suites, App replacement, credential reads, mainline
edits, push or cleanup were performed in this follow-up.
