# Director doctrine ledger

> **Generated** by `scripts/gen_director_doctrine_ledger.py` from
> `plugins/coc-keeper/references/director-graph.json`. Do not hand-edit.
> **Spec:** [pi-coc-director-graph-runtime](../specs/pi-coc-director-graph-runtime.md)
> **Inventory:** [director-doctrine-inventory](director-doctrine-inventory.md)

This is slice D2's headline deliverable. It does not explain the
Director's numbers — it records, per value, whether anyone can.

## Summary

| | Count |
| --- | --- |
| Doctrine nodes | 140 |
| Individual tunable values | 158 |
| `authored-doctrine` | 136 |
| `rule-derived` | 4 |
| ...of which `origin: unknown-legacy-tuning` | 136 |

### Sensitivity triage

Deterministic sweep over the D4 decision matrix (`memory-playtest-20260820`, structure type `branching_investigation`, 150 rows):

| Verdict | Count | Meaning |
| --- | --- | --- |
| `decision-changing` | 17 | perturbing the value moves real decisions; settling it needs a play experiment |
| `inert-in-matrix` | 18 | exercised by this checkpoint, but perturbing it changed no decision |
| `not-exercised` | 111 | the probe never reads it — another structure type, or a layer (storylet scheduling, time advance, affordance budget) this matrix does not exercise; the sweep says nothing about it |

`inert-in-matrix` is a statement about this matrix on this
checkpoint, never a claim that a value is globally irrelevant. A
decision change is not a quality judgement either — the sweep only
says which values are worth spending an experiment on.

**136 of 140 doctrine nodes (97%) cannot name their origin.** Each carries a `falsifiable_by` describing the DebugExperiment that could settle it. Retiring them one recorded experiment at a time is slice D5.

## Values that can cite a source

| Node | Value | Origin |
| --- | --- | --- |
| `craft-directive:dying-clock-kind` | `None` | coc_story_director control branch, grounded in the coc7 RuleGraph |
| `craft-directive:dying-forces-rescue-subsystem` | `None` | coc_story_director control branch, grounded in the coc7 RuleGraph |
| `scoring-rule:pressure:pushed-fail-nudge` | `0.1` | Keeper Rulebook 40th Anniversary p.83-85, cited in coc_story_director._base_score |
| `threshold:fair-warning-lethal-chances` | `gte 3` | Keeper Rulebook 40th Anniversary p.209, cited in coc_story_director._apply_fair_warning_ladder |

## Values with no known origin

Ordered by node kind. `falsifiable_by` is the experiment that would
settle the value; it is the entry point for slice D5.

### `scoring-rule` (18)

| Node | Value | Sensitivity | Falsifiable by |
| --- | --- | --- | --- |
| `scoring-rule:character:agenda-npc-in-scene` | `0.7` | not-exercised | Lanes on a checkpoint with both an available clue and an agenda NPC; vary this value and compare REVEAL-vs-CHARACTER. |
| `scoring-rule:choice:two-undiscovered-clues` | `0.7` | decision-changing (9) | Lanes from a stuck-intent checkpoint with exactly two undiscovered clues; vary this value and compare against the redirection path. |
| `scoring-rule:cut:exit-condition-met` | `0.8` | not-exercised | Lanes from a checkpoint whose exit condition is met while a threat clock is near full; compare CUT-vs-PRESSURE. |
| `scoring-rule:cut:explicit-move-intent` | `1.0` | not-exercised | Lanes on a move-intent checkpoint under hub_sandbox (CUT weight 0.7); confirm whether movement still wins after weighting. |
| `scoring-rule:cut:main-line-complete` | `0.7` | not-exercised | Lanes from a main-line-complete checkpoint in a non-final scene; vary this value and compare whether the Director pushes toward the ending. |
| `scoring-rule:cut:stalled-transition-pressure` | `[0.45, 0.15, 0.85]` | not-exercised | Lanes replaying a checkpoint at two, three and four stalled turns; compare the turn at which CUT overtakes RECOVER. |
| `scoring-rule:deepen:dramatic-question-present` | `0.5` | decision-changing (1) | Lanes on a checkpoint with a dramatic question and no available clue; vary the DEEPEN base and compare against the CHOICE no-trigger default. |
| `scoring-rule:montage:montage-intent` | `0.6` | decision-changing (1) | Lanes on a montage-intent checkpoint that also has an available clue; compare MONTAGE-vs-REVEAL. |
| `scoring-rule:payoff:structured-entity-overlap` | `[0.15, 0.12, 0.85]` | not-exercised | Lanes on a checkpoint with one-entity and three-entity temporal overlap; compare when PAYOFF first wins. |
| `scoring-rule:pressure:baseline` | `0.2` | inert-in-matrix (0) | Lanes on a calm checkpoint under the multi_faction weight (PRESSURE 1.2); vary the baseline and compare whether PRESSURE ever wins from calm. |
| `scoring-rule:pressure:cautious-posture-adjust` | `-0.1` | inert-in-matrix (0) | Lanes replaying one checkpoint with cautious and neutral posture; compare selected action at equal base. |
| `scoring-rule:pressure:clock-near-full-or-stalled` | `0.8` | decision-changing (2) | Lanes from a checkpoint with one stalled turn; vary this value and compare selected action. |
| `scoring-rule:pressure:reckless-posture-adjust` | `0.1` | decision-changing (14) | Lanes replaying one checkpoint with reckless and neutral rich-intent posture; compare selected action at equal base. |
| `scoring-rule:pressure:yielded-scene` | `0.85` | not-exercised | Lanes from a checkpoint with two recorded low-agency continues; vary this value and compare whether the Director escalates or keeps revealing. |
| `scoring-rule:recover:stalled-turns` | `0.85` | decision-changing (22) | Lanes from a two-stall checkpoint with pressure available; confirm the tiebreak resolves to RECOVER and compare play quality. |
| `scoring-rule:reveal:investigate-intent` | `0.9` | decision-changing (4) | Two production lanes on one settled investigation checkpoint, REVEAL base varied against the committed value; compare selected action and whether the turn still delivers the clue. |
| `scoring-rule:reveal:social-intent` | `0.75` | not-exercised | Two lanes on a social checkpoint with an agenda NPC present; vary the social REVEAL base and compare REVEAL-vs-CHARACTER selection. |
| `scoring-rule:subsystem:combat-flee-cast-intent` | `0.9` | decision-changing (6) | Lanes on a checkpoint with both combat intent and an available clue; confirm the tiebreak resolves to SUBSYSTEM. |

### `structure-weight` (70)

| Node | Value | Sensitivity | Falsifiable by |
| --- | --- | --- | --- |
| `structure-weight:branching-investigation:character` | `0.9` | inert-in-matrix (0) | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:branching-investigation:choice` | `1.3` | decision-changing (6) | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:branching-investigation:cut` | `0.8` | inert-in-matrix (0) | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:branching-investigation:deepen` | `1.1` | inert-in-matrix (0) | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:branching-investigation:montage` | `0.9` | inert-in-matrix (0) | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:branching-investigation:payoff` | `0.9` | inert-in-matrix (0) | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:branching-investigation:pressure` | `1.0` | inert-in-matrix (0) | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:branching-investigation:recover` | `1.1` | decision-changing (22) | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:branching-investigation:reveal` | `1.2` | decision-changing (4) | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:branching-investigation:subsystem` | `1.0` | decision-changing (6) | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:campaign-sequel:character` | `1.3` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:campaign-sequel:choice` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:campaign-sequel:cut` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:campaign-sequel:deepen` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:campaign-sequel:montage` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:campaign-sequel:payoff` | `1.3` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:campaign-sequel:pressure` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:campaign-sequel:recover` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:campaign-sequel:reveal` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:campaign-sequel:subsystem` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hub-sandbox:character` | `1.1` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hub-sandbox:choice` | `1.3` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hub-sandbox:cut` | `0.7` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hub-sandbox:deepen` | `0.9` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hub-sandbox:montage` | `1.1` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hub-sandbox:payoff` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hub-sandbox:pressure` | `0.8` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hub-sandbox:recover` | `1.2` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hub-sandbox:reveal` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hub-sandbox:subsystem` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hybrid-mega:character` | `1.1` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hybrid-mega:choice` | `1.1` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hybrid-mega:cut` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hybrid-mega:deepen` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hybrid-mega:montage` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hybrid-mega:payoff` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hybrid-mega:pressure` | `1.2` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hybrid-mega:recover` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hybrid-mega:reveal` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:hybrid-mega:subsystem` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:linear-acts:character` | `0.9` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:linear-acts:choice` | `0.7` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:linear-acts:cut` | `1.2` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:linear-acts:deepen` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:linear-acts:montage` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:linear-acts:payoff` | `0.8` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:linear-acts:pressure` | `0.9` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:linear-acts:recover` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:linear-acts:reveal` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:linear-acts:subsystem` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:multi-faction:character` | `1.3` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:multi-faction:choice` | `1.3` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:multi-faction:cut` | `0.8` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:multi-faction:deepen` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:multi-faction:montage` | `0.9` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:multi-faction:payoff` | `0.9` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:multi-faction:pressure` | `1.2` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:multi-faction:recover` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:multi-faction:reveal` | `0.8` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:multi-faction:subsystem` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:time-loop:character` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:time-loop:choice` | `0.9` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:time-loop:cut` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:time-loop:deepen` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:time-loop:montage` | `0.8` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:time-loop:payoff` | `1.3` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:time-loop:pressure` | `1.3` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:time-loop:recover` | `1.2` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:time-loop:reveal` | `0.9` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |
| `structure-weight:time-loop:subsystem` | `1.0` | not-exercised | Two production lanes on one settled checkpoint under this structure type, this cell varied against the committed value; compare the selected action and the resulting turn. |

### `tiebreak-order` (1)

| Node | Value | Sensitivity | Falsifiable by |
| --- | --- | --- | --- |
| `tiebreak-order:default` | `SUBSYSTEM > RECOVER > PRESSURE > REVEAL > CHOICE > CHARACTER > DEEPEN > CUT > PAYOFF > MONTAGE` | - | Lanes on a checkpoint that ties SUBSYSTEM with REVEAL; swap the two leading entries and compare the selected action. |

### `threshold` (46)

| Node | Value | Sensitivity | Falsifiable by |
| --- | --- | --- | --- |
| `threshold:choice-undiscovered-clue-count` | `gte 2` | decision-changing (18) | Lanes with one and two undiscovered clues under stuck intent; compare CHOICE availability. |
| `threshold:clue-policy-lead-count` | `lte 2` | not-exercised | Lanes on a scene with five available clues; vary the lead count and compare whether the Keeper's reveal stays focused. |
| `threshold:clue-route-default-priority` | `eq 0.5` | not-exercised | Lanes on a scene mixing authored and unauthored route priorities; compare route ordering. |
| `threshold:compression-max-beats-ceiling` | `lte 8` | not-exercised | Lanes with an authored max_beats of sixteen; confirm the clamp and compare pacing. |
| `threshold:compression-max-beats-default` | `eq 4` | not-exercised | Lanes on a low-agency stretch with the default and a doubled cap; compare beats spent before the Director forces progress. |
| `threshold:compression-max-beats-floor` | `gte 2` | not-exercised | Lanes with an authored max_beats of one; confirm the clamp and compare pacing. |
| `threshold:compression-max-minutes-ceiling` | `lte 30` | not-exercised | Lanes with an authored max_minutes of ninety; confirm the clamp. |
| `threshold:compression-max-minutes-default` | `eq 10` | not-exercised | Lanes with ten and thirty minute caps; compare in-fiction clock drift over a low-agency stretch. |
| `threshold:compression-min-beats-default` | `eq 2` | not-exercised | Lanes with min_beats one and two; compare the shortest compressed stretch. |
| `threshold:cut-stalled-transition-turns` | `gte 2` | not-exercised | Lanes at one, two and three stalled turns; compare when transition pressure appears. |
| `threshold:default-clock-segments` | `eq 6` | inert-in-matrix (0) | Lanes on a checkpoint carrying a clock with no authored segments; vary the default and compare escalation timing. |
| `threshold:fumble-tick-bound` | `lte 4` | not-exercised | Not a pacing choice so much as an accepted bound; vary it and confirm whether any authored effect legitimately exceeds it. |
| `threshold:live-affordance-merge-cap` | `lte 6` | inert-in-matrix (0) | Lanes on a scene whose authored and live affordances overlap heavily; vary the merge cap and compare what reaches the projection. |
| `threshold:live-affordance-minimum` | `lt 2` | inert-in-matrix (0) | Lanes on a scene with exactly one authored route; vary the minimum and compare the presented options. |
| `threshold:live-affordance-return-cap` | `lte 3` | inert-in-matrix (0) | Lanes on a scene with five distinct affordances; vary the cap and compare Keeper choice quality. |
| `threshold:live-affordance-route-cap` | `gte 3` | inert-in-matrix (0) | Lanes on a scene with six routes; vary the cap and compare whether the Keeper still finds the route the player wanted. |
| `threshold:low-agency-max-beats-fallback` | `eq 4` | not-exercised | Lanes on an unbudgeted bridge scene; vary the fallback and compare when the bridge exhausts. |
| `threshold:memory-callback-candidate-floor` | `gte 20` | not-exercised | Lanes on a turn with two references; vary the floor and compare whether a relevant callback is found. |
| `threshold:memory-callback-overlap-weight` | `eq 4` | not-exercised | Lanes where a one-entity and a three-entity callback compete; vary the weight and compare the pick. |
| `threshold:memory-callback-refs-multiplier` | `eq 5` | not-exercised | Lanes on a reference-rich turn; vary the multiplier and compare callback quality. |
| `threshold:memory-callback-score-digits` | `eq 3` | not-exercised | Not independently falsifiable in play; recorded so the value is not an untracked literal. |
| `threshold:mythos-signature-sample` | `lte 2` | not-exercised | Lanes on a mythos encounter; vary the sample size and compare how much the narration gives away. |
| `threshold:override-low-agency-count` | `gte 2` | decision-changing (15) | Lanes at one and two continues; compare whether the override fires and scoring is bypassed. |
| `threshold:override-stalled-turns` | `gte 3` | decision-changing (3) | Lanes at two, three and four stalled turns; compare override timing against scoring-level escalation. |
| `threshold:pressure-clock-near-full-fraction` | `[2, 3]` | inert-in-matrix (0) | Lanes on a checkpoint with a clock at one half, two thirds and three quarters; compare when the Director escalates. |
| `threshold:pressure-move-low-agency-count` | `gte 2` | not-exercised | Lanes at one and two continues with zero stalled turns; compare pressure-move presence. |
| `threshold:pressure-move-stalled-gate` | `gte 1` | not-exercised | Lanes at zero and one stalled turn under a REVEAL action; compare whether a pressure move accompanies the reveal. |
| `threshold:pressure-posture-ceiling` | `lte 0.95` | inert-in-matrix (0) | Lanes on a reckless-posture checkpoint that also has explicit move intent; raise the ceiling to 1.0 and compare PRESSURE-vs-CUT. |
| `threshold:pressure-posture-floor` | `gte 0.05` | inert-in-matrix (0) | Lanes on a cautious-posture calm checkpoint under the multi_faction weight; drop the floor to 0.0 and compare whether PRESSURE leaves scoring. |
| `threshold:pressure-stalled-turns` | `gte 1` | decision-changing (6) | Lanes at zero and one stalled turn; compare whether the Director escalates after one quiet turn. |
| `threshold:pressure-yielded-low-agency-count` | `gte 2` | inert-in-matrix (0) | Lanes replaying at one and two low-agency continues; compare escalation timing. |
| `threshold:recent-intent-window` | `lte 5` | not-exercised | Lanes with a three and a ten turn window over a low-agency stretch; compare when PRESSURE and the Layer-3 override fire. |
| `threshold:recover-stalled-turns` | `gte 2` | decision-changing (24) | Lanes at one and two stalled turns; compare RECOVER availability. |
| `threshold:scene-exit-pressure-continue-count` | `gte 2` | not-exercised | Lanes at one and two continues; compare whether the exit directive reaches the Keeper. |
| `threshold:score-precision-digits` | `eq 4` | inert-in-matrix (0) | Lanes with two and six digits of precision on a checkpoint where two actions score within 1e-5; compare tiebreak frequency. |
| `threshold:storylet-need-stalled-turns` | `gte 3` | not-exercised | Lanes at two, three and four stalled turns; compare when the inferred story need changes and whether it should move with the Layer-3 override. |
| `threshold:storylet-recent-window` | `lte 8` | not-exercised | Lanes over a long session with a four and a sixteen entry window; compare how quickly families become reusable. |
| `threshold:storylet-used-targets-window` | `lte 16` | not-exercised | Lanes over a session revisiting one target; vary the window and compare repetition. |
| `threshold:storylet-used-window` | `lte 999` | not-exercised | Lanes over a long session with a bounded used window; compare whether early families ever return to full weight. |
| `threshold:time-advance-confidence-digits` | `eq 2` | not-exercised | Not independently falsifiable in play; recorded so the value is not an untracked literal. |
| `threshold:time-advance-deadline-confidence` | `eq 0.6` | not-exercised | Lanes with an imminent deadline; vary the confidence and compare downstream handling. |
| `threshold:time-advance-deadline-delta-minutes` | `eq 5` | not-exercised | Lanes with an imminent deadline; vary the minimal advance and compare deadline pressure across a scene. |
| `threshold:time-advance-default-confidence` | `eq 0.7` | not-exercised | Lanes comparing a low and a high default confidence on an ordinary turn; compare whether the apply layer's handling of the proposal changes. |
| `threshold:time-advance-exhaustion-confidence` | `eq 0.85` | not-exercised | Lanes on an exhausted investigator; vary the confidence and compare downstream handling. |
| `threshold:time-advance-exhaustion-delta-minutes` | `eq 480` | not-exercised | Lanes with a six-hour and an eight-hour sleep; compare which day-reset triggers fire. |
| `threshold:time-advance-exhaustion-hours` | `gt 18` | not-exercised | Lanes at sixteen, eighteen and twenty hours since rest; compare when the sleep proposal appears. |

### `affinity-ladder` (1)

| Node | Value | Sensitivity | Falsifiable by |
| --- | --- | --- | --- |
| `affinity-ladder:pressure-move-scene-affinity` | `scene_clock_refs(6) > danger_ids(5) > scene_ids(4) > threat_front_ids(3) > scene_tags_any(2) > faction_ids(1) > fallback(0)` | - | Lanes on a checkpoint where two fronts match at different rungs; swap two adjacent rungs and compare which front supplies the pressure move. |

