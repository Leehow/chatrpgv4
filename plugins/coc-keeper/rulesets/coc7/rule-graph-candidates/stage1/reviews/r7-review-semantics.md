# R7 stage-1 semantic re-review

- Reviewer identity: `r7-review-semantics`
- Written: 2026-08-30T04:23:34Z
- Track: `pi-coc`

## Verdict

**APPROVE AS PREPARED CANDIDATES — still revision-required and unaccepted.**

- Social: unsupported higher-of composition and executable PC-coercion
  penalty were removed; explicit uncompiled markers remain.
- Psychology: unsupported success-to-truth/failure-to-mislead mapping was
  removed and marked uncompiled.
- Resource: the generic HP/MP/Luck delta channel was removed; remaining
  resources are family-scoped and source-narrowed.
- Core check, Push/Luck, and development/lookups remain partial.
- The reviewed production healing artifacts were byte-identical to their
  then-current pre-stage1 baselines; candidates did not redeclare healing HP.
- Candidate metadata correctly remained `review_status: revision-required`
  with no reviewer identity or accepted build digests.

This review did **not** accept, promote, build, or integrate the candidates.
It did not review combat and sanity beyond resource narrowing, runtime
integration, or promotion behavior. Verification commands were not rerun by
the reviewer.

The review predates the safety correction that returned healing from the
ineligible `graph/hidden` state to `shadow/visible`; its approval applies to
candidate semantics, not to that historical ownership value.
