# Human Calibration Review Instructions

These instructions prepare genuine human calibration for the COC Keeper
evaluation contract (`eval-spec-v1`). Software routes for release may request
review, but they never invent reviewer IDs, labels, timestamps, or agreement
scores.

## Canonical submission command

After completing blinded reviews with the template below, validate and score
agreement only through the canonical CLI:

```bash
python3 plugins/coc-keeper/scripts/coc_eval.py calibrate --reviews <reviews.json> --root .
```

Release aggregation consumes the same reviews file via:

```bash
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite release --root . \
  --chapter-run <run-dir> \
  --holdout-bundle <bundle-dir> \
  --calibration-reviews <reviews.json>
```

## What is invalid

Model-generated reviews are invalid human calibration. Do not submit AI-written
decisions, fabricated reviewer identities, or synthetic timestamps as human
evidence. Missing human reviews must remain `NOT_RUN`; they must never become
`PASS`.

## Blind request rules

Blind requests in `artifacts/human-review-bundle.json` contain only public A/B
sides, turn IDs, and rubric identity. They must not include baseline/candidate
labels, private label mappings, Keeper secrets, expected routes, or expected
outcomes.

## Filling the template

1. Copy `review-template.json`.
2. Keep `reviews` empty until real humans finish.
3. Require at least two distinct reviewer IDs before agreement can be computed.
4. Each review item must include structured `evidence_spans` with `turn_id` and
   `span_id` only—no free-prose keyword matching.
