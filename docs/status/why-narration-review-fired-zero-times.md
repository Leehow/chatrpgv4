# TextGraph gate 4's zero has a mechanical cause

> **Status:** finding, proven from preserved evidence. One follow-on question
> is a product decision and is left open.
> **Date:** 2026-09-01
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`

## What T5 left open

The TextGraph T5 run recorded `narration.review` firing **0 times in 60
canonical calls**, and refused to turn that into a verdict. Its stated reason
was sound: another run the *same day*, on the *same path and model*, made
**7** calls, so a single zero could not be attributed. It hypothesised that
`_pi_play_agency_review_required()` — hardcoded `False` since `ab634acd` —
explained it, then killed that hypothesis with the 7-call run.

The hypothesis was right. The refutation was wrong, for a reason neither run
could see from inside itself.

## The discriminator is per-campaign stored state, not the function

`agency_review_required` is read at
`coc_operation_turn_output.py:2520` from the campaign's **stored**
`contract_projection`, not from a live call:

```python
agency_review_required = contract_projection["agency_review_required"] is True
```

The function is consulted only when a projection is *built*
(`coc_operation_turn_output.py:624`). So the value a run sees is a fossil of
the code that created its campaign.

Measured in the preserved evidence:

| run | started | `agency_review_required` | `agency_review_operation` populated | `narration.review` calls |
| --- | --- | --- | --- | --- |
| `dirgraph-smoke-20260901` | 05:38 | **true** | 17 | 7 |
| `textgraph-t5-en-20260901` | 12:29 | **false** (×16) | 0 | 0 |

Both ran after `ab634acd` (08-31 21:00) landed. They differ because they ran
from different worktrees: before that commit the flag was environment-driven —

```python
return (os.environ.get("COC_PI_SESSION_ROLE") == "play"
        and not _pi_rules_director_single_draft_profile())
```

— and the DirectorGraph worktree had not merged it yet. **Two runs on the same
day, same model, same path, executing different code.** The comparison that
looked like a controlled pair was not one.

## What follows, and what does not

**Gate 4's zero is explained.** It is not a fact about model behaviour, nor
about the reachability of the published review vocabulary. Given
`agency_review_required=false`, the host never offers an
`agency_review_operation` card, and `host-system-play.md:465` explicitly
instructs the Keeper **"Do not call or discover `narration.review`"** on that
branch. A Keeper following the prompt correctly makes zero calls. The prompt is
not defective here; both branches are present and correctly conditioned.

**"Unreachable" would be too strong.** `narration.review` is still
`discovery: surface`, `kp_surface: advice` in the operation contract, so a
Keeper can still call it. It is *not offered*, not *not callable*.

**The open question is now a product one, not a measurement one.** T4 gate 3
published nine review rule ids into the model-visible contract. In current
production the operation that consumes them is switched off by design —
`ab634acd` retired the second narration/rewrite pass. So the published
vocabulary presently has no host-offered caller. Whether that is correct
depends on whether the second pass is meant to return; that is not a question
this document can answer, and it should not be answered by measurement.

## Collateral: 17 stale tests

`tests/test_narration_budget.py` has 17 failures, identical before and after
the TextGraph merge (verified by running the file at `bcde3d92` in a pinned
worktree). Several trace to the same retirement:

- 5 assert `agency_gate == "clear"` or `"rewrite_required"`. With the flag
  false, `coc_operation_turn_output.py:1372` always yields `"advisory"`.
- 2 `KeyError: 'agency_review_operation'` — the card is only attached when
  `agency_review_required and draft_contract_usable`.

The rest are separate causes: a `rules.sanity_check` schema that gained a
required `involuntary_action` in `b8534c8c`, `'not_applicable'` status
values, and a `frozen_narration_draft` key. They encode expectations from
before several deliberate changes and are not evidence of a live defect.

**They are deliberately left failing.** The three `agency_gate` tests do not
assert a value; they assert the whole hard-gate flow — `rewrite_required`, then
`turn.finalize` refused with `agency_review_blocked`, then a prose-only
revision 2. Turning them green means either deleting the coverage or rewriting
them to assert advisory behaviour, and choosing between those requires
answering a question this document deliberately does not:

> `ab634acd`'s comment retires the second **narration/rewrite pass**. The
> operation schema still describes `agency_violation` as *"the only hard
> gate"*. Are those the same thing? If the agency gate was meant to survive
> the retirement of the rewrite loop, then production currently has no hard
> gate on unauthorized PC agency, and these tests are the ones telling the
> truth.

That is a product decision, and rewriting a test suite is the wrong instrument
for making it. Recorded as CURRENT.md open item 9.

## Method note

The first reading of this chain was wrong and is recorded so the correction is
visible. Reading the code produced "`agency_review_operation` is never set",
which a grep of the evidence immediately contradicted — 1111 occurrences. Most
were prompt prose; some were real. Only separating *populated data fields* from
*instruction text*, per run, produced the actual discriminator. A confirmed
value in preserved evidence beats a plausible code path, again.
