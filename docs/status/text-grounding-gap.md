# TextGraph grounding gap

> **Generated** by `scripts/gen_text_grounding_ledger.py`. Do not edit by hand.
> Regenerated and compared by `tests/test_text_graph.py`, so it cannot rot.

- RuleGraph effect nodes: **23** (22 public, 1 keeper-only)
- `renders-settled-output` edges from TextGraph: **0**
- Effect kinds with an exact token match in the text layer: **luck_spend**

| effect | visibility | effect_kind | rendered by TextGraph | text-layer token match |
| --- | --- | --- | :-: | :-: |
| `effect:coc7:chase:barrier-barrier-resolved` | public | `barrier-resolved` | no | no |
| `effect:coc7:chase:conflict-conflict-resolved` | public | `conflict-resolved` | no | no |
| `effect:coc7:chase:end-chase-ended` | public | `chase-ended` | no | no |
| `effect:coc7:chase:hazard-hazard-resolved` | public | `hazard-resolved` | no | no |
| `effect:coc7:chase:move-position-changed` | public | `position-changed` | no | no |
| `effect:coc7:chase:start-chase-started` | public | `chase-started` | no | no |
| `effect:coc7:development:end-session-development-settled` | public | `development-settled` | no | no |
| `effect:coc7:development:end-session-ending-recorded` | public | `ending-recorded` | no | no |
| `effect:coc7:development:settle-ending-luck-recovery` | public | `luck-recovery` | no | no |
| `effect:coc7:development:settle-ending-san-reward` | public | `san-reward` | no | no |
| `effect:coc7:development:settle-ending-skill-improvement` | public | `skill-improvement` | no | no |
| `effect:coc7:healing:first-aid-stabilization` | public | `first-aid-hp-or-temporary-stabilization` | no | no |
| `effect:coc7:healing:medicine-stabilization` | public | `medicine-hp-or-dying-stabilization` | no | no |
| `effect:coc7:healing:weekly-hp-recovery` | public | `weekly-major-wound-hp-recovery` | no | no |
| `effect:coc7:magic:cast-spell-hp-overspill` | public | `hp-overspill` | no | no |
| `effect:coc7:magic:cast-spell-mp-spent` | public | `mp-spent` | no | no |
| `effect:coc7:magic:cast-spell-san-spent` | public | `san-spent` | no | no |
| `effect:coc7:magic:cast-spell-spell-cast` | public | `spell-cast` | no | no |
| `effect:coc7:magic:learn-spell-entity-san-cost` | public | `entity-san-cost` | no | no |
| `effect:coc7:magic:learn-spell-spell-learned` | public | `spell-learned` | no | no |
| `effect:coc7:magic:learn-spell-study-scheduled` | public | `study-scheduled` | no | no |
| `effect:coc7:push-luck:luck-spend-mutate` | keeper-only | `luck_spend` | no | yes |
| `effect:coc7:social:pc-refusal-penalty` | public | `one-use-penalty-die` | no | no |

## What this measures

An edge is drawn when a rendering path exists, never to reach a target
count. Today none exists: the text layer renders `turn-effect-v1` and
`exceptional-effect-v1` state effects, a namespace disjoint from
`effect:coc7:*`, and no code in the tree reads a RuleGraph effect id.

The single exact correspondence between the two vocabularies is
`luck_spend`, and it belongs to the one **keeper-only** effect. The text
layer names it only in `_narration_budget`, where it selects a length
budget and is never rendered. So the only place the two graphs touch is
the effect that must not reach the player.

The compiler's `renders-settled-output` validator is live regardless: a
dangling id, a non-effect node kind, or a keeper-only target fails the
build. The first real bridge is checkable the day it is built.
