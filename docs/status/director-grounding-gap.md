# DirectorGraph grounding gap

> **Generated** by `scripts/gen_director_grounding_ledger.py`. Do not edit by hand.
> Regenerated and compared by `tests/test_director_grounding.py`, so it cannot rot.

- Doctrine-plane nodes: **150**
- `grounded-by` registry edges from doctrine nodes: **7**
- RuleGraph decision/effect/rule nodes available as targets: **192**; registered condition paths: **43**

## Reason classes

| class | nodes | meaning |
| --- | :-: | --- |
| `grounded` | 4 | a registry `grounded-by` edge exists and resolves in the RuleGraph |
| `span-bound` | 1 | rule-derived through rulebook spans; the RuleGraph has no node for the rule, so no edge target exists |
| `resolvable` | 0 | a real RuleGraph target exists but no edge has been drawn — must stay zero after slice W2 |
| `pacing-state-read` | 36 | reads Director pacing state, not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `authored-no-source` | 109 | a design claim with no rule counterpart |

## Grounded doctrine

| node | evidence class | grounded-by targets |
| --- | --- | --- |
| `craft-directive:dying-clock-kind` | rule-derived | `decision:coc7:healing:dying-hour-clock`, `decision:coc7:healing:dying-round-clock` |
| `craft-directive:dying-forces-rescue-subsystem` | rule-derived | `rule:coc7:healing:dying-entry` |
| `scoring-rule:pressure:pushed-fail-nudge` | rule-derived | `decision:coc7:push-luck:pushed-roll` |
| `scoring-rule:subsystem:combat-flee-cast-intent` | authored-doctrine | `decision:coc7:combat:attack`, `decision:coc7:combat:flee`, `decision:coc7:magic:cast-spell` |

## Ungrounded doctrine

| node | kind | evidence class | reason class | reason |
| --- | --- | --- | --- | --- |
| `affinity-ladder:pressure-move-scene-affinity` | affinity-ladder | authored-doctrine | `authored-no-source` | ranks pressure-move sources by structured scene references; the rung order is a design claim |
| `multiplier:storylet-selection:conflict-rank-gap` | multiplier | authored-doctrine | `authored-no-source` | storylet selection weighting over conflict levels; a design claim |
| `multiplier:storylet-selection:family-repeat-penalty` | multiplier | authored-doctrine | `authored-no-source` | storylet family rotation penalty; a design claim |
| `multiplier:storylet-selection:polarity-match` | multiplier | authored-doctrine | `authored-no-source` | storylet polarity-match bonus; a design claim |
| `multiplier:storylet-selection:scene-tag-generic-suppression` | multiplier | authored-doctrine | `authored-no-source` | suppresses generic storylets while a scene tag summons beats; a design claim |
| `multiplier:storylet-selection:scene-tag-summoned-boost` | multiplier | authored-doctrine | `authored-no-source` | boosts scene-tag summoned storylets; a design claim |
| `multiplier:storylet-selection:serves-deepen-npc` | multiplier | authored-doctrine | `authored-no-source` | serves bonus for storylets that deepen a present NPC; a design claim |
| `multiplier:storylet-selection:serves-reveal-clue` | multiplier | authored-doctrine | `authored-no-source` | serves bonus for storylets that carry an available clue; a design claim |
| `multiplier:storylet-selection:serves-surface-choice` | multiplier | authored-doctrine | `authored-no-source` | serves bonus for storylets that surface a choice; a design claim |
| `multiplier:storylet-selection:serves-tick-front` | multiplier | authored-doctrine | `authored-no-source` | serves bonus for storylets that tick a live threat front; a design claim |
| `multiplier:storylet-selection:trope-repeat-penalty` | multiplier | authored-doctrine | `authored-no-source` | storylet trope rotation penalty; a design claim |
| `scoring-rule:character:agenda-npc-in-scene` | scoring-rule | authored-doctrine | `authored-no-source` | trigger is an authored NPC agenda in the scene; the score is a design claim |
| `scoring-rule:choice:two-undiscovered-clues` | scoring-rule | authored-doctrine | `authored-no-source` | trigger is the scene's undiscovered clue count; the score is a design claim |
| `scoring-rule:cut:exit-condition-met` | scoring-rule | authored-doctrine | `authored-no-source` | trigger is a met authored scene exit condition; the score is a design claim |
| `scoring-rule:cut:explicit-move-intent` | scoring-rule | authored-doctrine | `authored-no-source` | trigger is the classified player intent; the score is a pacing preference no rulebook rule fixes |
| `scoring-rule:cut:main-line-complete` | scoring-rule | authored-doctrine | `authored-no-source` | trigger is authored main-line completion; the score is a design claim |
| `scoring-rule:cut:stalled-transition-pressure` | scoring-rule | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `scoring-rule:deepen:dramatic-question-present` | scoring-rule | authored-doctrine | `authored-no-source` | trigger is an authored dramatic question; the score is a design claim |
| `scoring-rule:montage:montage-intent` | scoring-rule | authored-doctrine | `authored-no-source` | trigger is the classified player intent; the score is a pacing preference no rulebook rule fixes |
| `scoring-rule:payoff:structured-entity-overlap` | scoring-rule | authored-doctrine | `authored-no-source` | trigger is structured overlap between memory cards and the scene; the score is a design claim |
| `scoring-rule:pressure:baseline` | scoring-rule | authored-doctrine | `authored-no-source` | unconditional PRESSURE base score; a pacing constant no rule fixes |
| `scoring-rule:pressure:cautious-posture-adjust` | scoring-rule | authored-doctrine | `authored-no-source` | adjusts PRESSURE by the classified risk posture of rich player intent; a pacing preference no rule fixes |
| `scoring-rule:pressure:clock-near-full-or-stalled` | scoring-rule | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `scoring-rule:pressure:reckless-posture-adjust` | scoring-rule | authored-doctrine | `authored-no-source` | adjusts PRESSURE by the classified risk posture of rich player intent; a pacing preference no rule fixes |
| `scoring-rule:pressure:yielded-scene` | scoring-rule | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `scoring-rule:recover:stalled-turns` | scoring-rule | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `scoring-rule:reveal:investigate-intent` | scoring-rule | authored-doctrine | `authored-no-source` | trigger is the classified player intent; the score is a pacing preference no rulebook rule fixes |
| `scoring-rule:reveal:social-intent` | scoring-rule | authored-doctrine | `authored-no-source` | trigger is the classified player intent; the score is a pacing preference no rulebook rule fixes |
| `structure-weight:branching-investigation:character` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:branching-investigation:choice` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:branching-investigation:cut` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:branching-investigation:deepen` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:branching-investigation:montage` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:branching-investigation:payoff` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:branching-investigation:pressure` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:branching-investigation:recover` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:branching-investigation:reveal` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:branching-investigation:subsystem` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:campaign-sequel:character` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:campaign-sequel:choice` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:campaign-sequel:cut` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:campaign-sequel:deepen` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:campaign-sequel:montage` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:campaign-sequel:payoff` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:campaign-sequel:pressure` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:campaign-sequel:recover` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:campaign-sequel:reveal` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:campaign-sequel:subsystem` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hub-sandbox:character` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hub-sandbox:choice` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hub-sandbox:cut` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hub-sandbox:deepen` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hub-sandbox:montage` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hub-sandbox:payoff` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hub-sandbox:pressure` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hub-sandbox:recover` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hub-sandbox:reveal` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hub-sandbox:subsystem` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hybrid-mega:character` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hybrid-mega:choice` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hybrid-mega:cut` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hybrid-mega:deepen` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hybrid-mega:montage` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hybrid-mega:payoff` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hybrid-mega:pressure` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hybrid-mega:recover` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hybrid-mega:reveal` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:hybrid-mega:subsystem` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:linear-acts:character` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:linear-acts:choice` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:linear-acts:cut` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:linear-acts:deepen` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:linear-acts:montage` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:linear-acts:payoff` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:linear-acts:pressure` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:linear-acts:recover` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:linear-acts:reveal` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:linear-acts:subsystem` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:multi-faction:character` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:multi-faction:choice` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:multi-faction:cut` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:multi-faction:deepen` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:multi-faction:montage` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:multi-faction:payoff` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:multi-faction:pressure` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:multi-faction:recover` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:multi-faction:reveal` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:multi-faction:subsystem` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:time-loop:character` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:time-loop:choice` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:time-loop:cut` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:time-loop:deepen` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:time-loop:montage` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:time-loop:payoff` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:time-loop:pressure` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:time-loop:recover` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:time-loop:reveal` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `structure-weight:time-loop:subsystem` | structure-weight | authored-doctrine | `authored-no-source` | Layer-2 pacing multiplier over module structure types; no rulebook rule fixes how a structure prefers actions |
| `threshold:choice-undiscovered-clue-count` | threshold | authored-doctrine | `authored-no-source` | gate over the scene's authored clue list; no rulebook rule sets it |
| `threshold:clue-policy-lead-count` | threshold | authored-doctrine | `authored-no-source` | Keeper-facing clue policy cap; a design claim |
| `threshold:clue-route-default-priority` | threshold | authored-doctrine | `authored-no-source` | clue route priority default; a design claim |
| `threshold:compression-max-beats-ceiling` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:compression-max-beats-default` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:compression-max-beats-floor` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:compression-max-minutes-ceiling` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:compression-max-minutes-default` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:compression-min-beats-default` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:cut-stalled-transition-turns` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:default-clock-segments` | threshold | authored-doctrine | `pacing-state-read` | default segment count for threat clocks, a Director pacing construct distinct from the RuleGraph dying clock |
| `threshold:fair-warning-lethal-chances` | threshold | rule-derived | `span-bound` | rule-derived from Keeper Rulebook p.209; the RuleGraph has no fair-warning node, so no edge target exists |
| `threshold:fumble-tick-bound` | threshold | authored-doctrine | `authored-no-source` | acceptance bound for authored fumble-effect clock ticks; the RuleGraph has no exceptional-effect node to ground it |
| `threshold:live-affordance-merge-cap` | threshold | authored-doctrine | `authored-no-source` | cap over live scene affordances; a design claim |
| `threshold:live-affordance-minimum` | threshold | authored-doctrine | `authored-no-source` | minimum live scene affordances; a design claim |
| `threshold:live-affordance-return-cap` | threshold | authored-doctrine | `authored-no-source` | cap over returned live scene affordances; a design claim |
| `threshold:live-affordance-route-cap` | threshold | authored-doctrine | `authored-no-source` | cap over routed live scene affordances; a design claim |
| `threshold:low-agency-max-beats-fallback` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:memory-callback-candidate-floor` | threshold | authored-doctrine | `authored-no-source` | memory callback candidate floor; a design claim |
| `threshold:memory-callback-overlap-weight` | threshold | authored-doctrine | `authored-no-source` | memory callback overlap weight; a design claim |
| `threshold:memory-callback-refs-multiplier` | threshold | authored-doctrine | `authored-no-source` | memory callback refs multiplier; a design claim |
| `threshold:memory-callback-score-digits` | threshold | authored-doctrine | `authored-no-source` | score rounding precision for memory callbacks; a formatting constant |
| `threshold:mythos-signature-sample` | threshold | authored-doctrine | `authored-no-source` | caps the signature elements sampled into a mythos presentation directive; a design claim |
| `threshold:override-low-agency-count` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:override-stalled-turns` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:pressure-clock-near-full-fraction` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:pressure-move-low-agency-count` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:pressure-move-stalled-gate` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:pressure-posture-ceiling` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:pressure-posture-floor` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:pressure-stalled-turns` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:pressure-yielded-low-agency-count` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:recent-intent-window` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:recover-stalled-turns` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:scene-exit-pressure-continue-count` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:score-precision-digits` | threshold | authored-doctrine | `authored-no-source` | score rounding precision; a formatting constant |
| `threshold:storylet-need-stalled-turns` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:storylet-recent-window` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:storylet-used-targets-window` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:storylet-used-window` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:time-advance-confidence-digits` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:time-advance-deadline-confidence` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:time-advance-deadline-delta-minutes` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:time-advance-default-confidence` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:time-advance-exhaustion-confidence` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:time-advance-exhaustion-delta-minutes` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `threshold:time-advance-exhaustion-hours` | threshold | authored-doctrine | `pacing-state-read` | reads Director pacing state (stalled turns, low-agency counts, clocks, budgets, ledgers or plan signals), not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |
| `tiebreak-order:default` | tiebreak-order | authored-doctrine | `authored-no-source` | deterministic tie resolution order; no rulebook rule ranks pacing actions |

## What this measures

Slice W2 (`docs/specs/pi-coc-cross-graph-wiring.md` §5) extended the
Director's `grounded-by` surface past the dying family after the
ten-family RuleGraph cutover promoted push-luck, combat and magic.
The grounded set above is every doctrine node with a registry edge;
each target resolves in `rulesets/coc7/rule-graph.json` and the
registry validator fails closed on a dangling one.

The ungrounded rows are not unfinished work. A `grounded-by` edge is
only honest when the doctrine realises a rule the RuleGraph carries;
pacing counters, structure weights, tiebreaks and policy constants
have no such rule, and inventing approximate targets would repeat the
failure class this ledger exists to prevent. The pre-cutover claim
that push-luck and pacing families were "still unresolved in the
RuleGraph" was deleted with slice W2: push-luck is resolved and now
carries the pushed-failure nudge edge; the pacing family is a
Director-owned construct with no RuleGraph representation, which is
what `pacing-state-read` records.

`scoring-rule:subsystem:combat-flee-cast-intent` keeps its
`authored-doctrine` class even though it is grounded: the handoff
targets are rule decisions, but no rulebook rule fixes the pacing
score itself. A `grounded-by` edge records applicability, not value
provenance.
