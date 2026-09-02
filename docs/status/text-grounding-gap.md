# TextGraph grounding gap

> **Generated** by `scripts/gen_text_grounding_ledger.py`. Do not edit by hand.
> Regenerated and compared by `tests/test_text_graph.py`, so it cannot rot.

- RuleGraph effect nodes: **23** (22 public, 1 keeper-only)
- `renders-settled-output` edges from TextGraph: **3**
- Grounding reasons: **keeper-only** × 1, **no-consumer-yet** × 19, **rendered** × 3
- Effect kinds with an exact token match in the text layer: **luck_spend**

| effect | visibility | effect_kind | rendered by TextGraph | text-layer token match | grounding reason |
| --- | --- | --- | :-: | :-: | --- |
| `effect:coc7:chase:barrier-barrier-resolved` | public | `barrier-resolved` | no | no | no-consumer-yet |
| `effect:coc7:chase:conflict-conflict-resolved` | public | `conflict-resolved` | no | no | no-consumer-yet |
| `effect:coc7:chase:end-chase-ended` | public | `chase-ended` | no | no | no-consumer-yet |
| `effect:coc7:chase:hazard-hazard-resolved` | public | `hazard-resolved` | no | no | no-consumer-yet |
| `effect:coc7:chase:move-position-changed` | public | `position-changed` | no | no | no-consumer-yet |
| `effect:coc7:chase:start-chase-started` | public | `chase-started` | no | no | no-consumer-yet |
| `effect:coc7:development:end-session-development-settled` | public | `development-settled` | no | no | no-consumer-yet |
| `effect:coc7:development:end-session-ending-recorded` | public | `ending-recorded` | no | no | no-consumer-yet |
| `effect:coc7:development:settle-ending-luck-recovery` | public | `luck-recovery` | no | no | no-consumer-yet |
| `effect:coc7:development:settle-ending-san-reward` | public | `san-reward` | no | no | no-consumer-yet |
| `effect:coc7:development:settle-ending-skill-improvement` | public | `skill-improvement` | no | no | no-consumer-yet |
| `effect:coc7:healing:first-aid-stabilization` | public | `first-aid-hp-or-temporary-stabilization` | yes | no | rendered |
| `effect:coc7:healing:medicine-stabilization` | public | `medicine-hp-or-dying-stabilization` | yes | no | rendered |
| `effect:coc7:healing:weekly-hp-recovery` | public | `weekly-major-wound-hp-recovery` | yes | no | rendered |
| `effect:coc7:magic:cast-spell-hp-overspill` | public | `hp-overspill` | no | no | no-consumer-yet |
| `effect:coc7:magic:cast-spell-mp-spent` | public | `mp-spent` | no | no | no-consumer-yet |
| `effect:coc7:magic:cast-spell-san-spent` | public | `san-spent` | no | no | no-consumer-yet |
| `effect:coc7:magic:cast-spell-spell-cast` | public | `spell-cast` | no | no | no-consumer-yet |
| `effect:coc7:magic:learn-spell-entity-san-cost` | public | `entity-san-cost` | no | no | no-consumer-yet |
| `effect:coc7:magic:learn-spell-spell-learned` | public | `spell-learned` | no | no | no-consumer-yet |
| `effect:coc7:magic:learn-spell-study-scheduled` | public | `study-scheduled` | no | no | no-consumer-yet |
| `effect:coc7:push-luck:luck-spend-mutate` | keeper-only | `luck_spend` | no | yes | keeper-only |
| `effect:coc7:social:pc-refusal-penalty` | public | `one-use-penalty-die` | no | no | no-consumer-yet |

## What this measures

An edge is drawn when a rendering path exists, never to reach a target
count. Slice W1 built the first one: the healing decisions emit three
public effects, and their graph-owned settlements carry a
`player_state_receipt` that `coc_turn_finalization` projects into the
`state_delta` mechanics segment — the chain `segment-type:state-delta`
renders. The W1 runtime bridge tags those derived effects with
`rule_effect_refs`, so the rendered mechanics block is auditable back
to the exact RuleGraph effect.

The unbridged public effects are measured, not promised: their family's
settle receipt carries no rendered state delta (`no-consumer-yet`), or
a consumer exists but nothing renders this effect
(`no-rendering-counterpart`). Drawing their edges before a consumer
exists is the hollow delivery the wiring spec forbids.

The single exact correspondence between the two vocabularies remains
`luck_spend`, and it belongs to the one **keeper-only** effect. The
text layer names it only in `_narration_budget`, where it selects a
length budget and is never rendered; presentation may never claim it.

The compiler's `renders-settled-output` validator is live: a dangling
id, a non-effect node kind, or a keeper-only target fails the build.
